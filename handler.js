var Promise = require("bluebird")
var R = require('ramda')
var indexBy = require('lodash.indexby')
var AWS = require('aws-sdk')
	//todo-james move into environment variables or something ... later
	AWS.config.secretAccessKey = 'SauFXOTApM5WnBIX+LN6s3a2ZVA7UdkIzPkz7MGl'
	AWS.config.accessKeyId = 'AKIAJL2F723YMP4FC6QQ'

var fs = Promise.promisifyAll(require('fs-extra'))
var archiver = require('archiver')
var rm = Promise.promisify(fs.remove)
var mkdirs = Promise.promisify(fs.mkdirs)

var request = require('request')
var requestP = Promise.promisify(request)
var config;
var S3, lambda
var exec = Promise.promisify(require('child_process').exec)

var path = require('path')
var os = require('os')

var tmp_path = path.resolve( os.tmpdir(), 'shepherd' )
var tmp_file = path.resolve(tmp_path,'repository.zip')

var log = function(message){
	return function(){
		console.log(message)	
		return arguments[0]
	}
}

var error = function(message){
	return function(error){
		console.error(message,error)
		return arguments[0]	
	}
}

/*
*	Responds to two different kind of requests:
*
*	-	Github Push SNS Hook
*	-	Amazon SNS updated Lambda hook
*
*	When it receives a github hook, it will update the deployment script (this one)
*	Then when the deployment hook is updated, the current hook will send a notification to deploy the other endpoints
*/
function handler(event, context){
	var archive;
	if(event.refs.indexOf("master") > -1){
		var config_url = "https://raw.githubusercontent.com/" + event.repository.full_name + "/master/lambdas.json"
		var zip_url = "http://github.com/"+ event.repository.full_name +"/zipball/master/"
		
		console.log("Normalizing zip file for "+event.repository.full_name)
		normalizeZip(zip_url)
			.then(log("Zip file has successfully been normalized"))
			.then(log("Download config file from Github"))
			.then(function(archiveStream){
				archive = archiveStream
				
				return requestP(config_url)
			})
			.then(log("Config file has been downloaded"))
			.then(
				R.pipe( R.tail, JSON.parse )
			)
			.then(log("Config file was successfully parsed"))
			.then(function(parsed){
				config = parsed 
			})
			.then(function(){
				
				S3 = new AWS.S3({ region: config.region })
				lambda = new AWS.Lambda({ region: config.region })
				archive.finalize()
				console.log("Now uploading normalized zip to S3")
				S3.upload({
					Bucket: config.bucket,
					Key: config.bucket_key,
					Body: archive
				}, function(err, data){
					if(err) {
						console.log(err)
						//todo-james is there a context.fail?
						context.done(err) 
					} else {
						//todo-james do this earlier in parallel
						console.log("Now requesting Amazon for existing list of lambdas")
						lambda.listFunctions({}, function(err, lambdas){
							if(err) {
								console.error(err)	
							} else {
								console.log("Lambdas returned", lambda.Functions)
								var existing = indexBy(lambdas.Functions, 'FunctionName')
								Promise.settle(
									config.lambdas.map( patch(existing) )
								)
								.then(console.log)
								.catch(console.error)
								.finally(function(response){
									context.done(null, response)
								})	
							}
							
						})
						
					}
				})
			})
		
		
	}
}



var patch = R.curry(function (existing, lambda){
	return (
		lambda.FunctionName in existing ? updateLambda : createLambda
	)(lambda)
		.then(log( lambda.FunctionName + " successfully updated"))
		.catch(error( lambda.FunctionName + " could not update"))
		
})

function updateLambda(params){
	var updateParams = { 
		FunctionName: params.FunctionName,
		S3Bucket: config.bucket,
		S3Key: config.bucket_key 
	}
	
	return new Promise(function(Y,N){
		lambda.updateFunctionCode(updateParams, function(err, data){
			
			return err ? N(err) : Y(data)
		})
	})
}

function createLambda(params){
	var createParams = R.merge(
		params, 
		{ 
			Code: { S3Bucket: config.bucket, S3Key: config.bucket_key  }
		}
	)
	return new Promise(function(Y,N){
		lambda.createFunction(createParams, function(err, data){
			
			return err ? N(err) : Y(data)
		})
	})
}


/*
*	Formats the repository zip that github generates, so that Amazon can access the lambdas.
*/
function normalizeZip(http_url){
	var unzip_command = 'pushd '+tmp_path+' && unzip '+tmp_file
	var normalize_command = ('pushd {github_folder} && gzip -r ' + tmp_file + ' * && popd')

	console.log("Creating tmp directory")
	//ensure the tmp directory exists
	return mkdirs(tmp_path)
		.then(log("tmp directory successfully created"))
		.then(log("Clearing tmp directory"))
		//ensure the tmp folder is empty each time
		.finally(function() { return fs.emptyDirAsync( tmp_path ) })
		.then(log( "tmp directory cleared" ))
		
		.then(log( "streaming zip file from github to the lambda server"))
		//stream the zip file from github to the local file system
		.finally(function(){
			
			
			return new Promise(function(Y,N){
				var readStream = request(http_url)
				var writeStream = fs.createWriteStream(tmp_file);
				
				readStream.pipe(writeStream)
				
				readStream.on('end', function(){
					writeStream.end() 
				})
				
				writeStream.on('finish', function(){
					console.log("Streaming complete.  Zip downloaded to "+tmp_path)
					Y(tmp_file)
				})
				
				readStream.on('error',N)
			})	
		})
		
		//remove the containing folder that github inserts into the zip
		//then rebundle it up so Amazon can access the handler(s)
		.then(function(){
			
			//unzip
			console.log("Unzipping the downloaded repository")
			return exec(unzip_command)
				.then(log("Repository successfully unzipped"))
				//remove the zip so the extracted folder is the only item in the tmp directory
				.then(log("Deleting downloaded zip"))
				.then(function(){
					return fs.unlinkAsync(tmp_file)
						.then(log("Zip successfully deleted"))
				})
				
				//get the name of the containing folder that github generated
				
				.then(log("Identifying Github generated parent folder name"))
				.then(function(){
					return fs.readdirAsync(tmp_path)
				})
				.then(R.head)
				.then(log("Github generated name is identified"))
				//enter the directory and zip up its contents as tmp_file
				.then(log("Removing containing folder and rearchive"))
				.then(function(github_folder){
					github_folder = path.resolve(tmp_path,github_folder)
					//creates a stream of a zip archive that we can stream to s3
					var archive = archiver('zip',{})
					archive.directory(
						path.resolve(tmp_path, github_folder),
						false
					)
					return archive
				})
				
		})
}

handler({
	refs: "refs/branch/master",
	repository: {
		full_name: "JAForbes/dphoto-lambdas"
	}
}, { done: R.identity })

exports.handler = handler