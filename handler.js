var Promise = require("bluebird")
var R = require('ramda')
var _ = require('lodash')
var AWS = require('aws-sdk')
	//todo-james move into environment variables or something ... later
	AWS.config.secretAccessKey = 'SauFXOTApM5WnBIX+LN6s3a2ZVA7UdkIzPkz7MGl'
	AWS.config.accessKeyId = 'AKIAJL2F723YMP4FC6QQ'

var fs = require('fs')
var request = require('request')
var requestP = Promise.promisify(request)
var config;
var S3, lambda
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
	if(event.refs.indexOf("master") > -1){
		var config_url = "https://raw.githubusercontent.com/" + event.repository.full_name + "/lambdas.json"
		var zip_url = "http://github.com/"+ event.repository.full_name +"/zipball/master/"
		requestP(config_url)
			.then(function(response){
				config = JSON.parse(response[1]) 
			})
			.then(function(){
				
				S3 = new AWS.S3()
				lambda = new AWS.Lambda()

				S3.upload({
					Bucket: config.bucket,
					Key: config.bucket_key,
					// will actually be zip_url later
					
					Body: fs.createReadStream(config.bucket_key)
				}, function(err, data){
					if(err) {
						console.log(err)
						//todo-james is there a context.fail?
						context.done(err) 
					} else {
						
						lambda.listFunctions({}, function(err, lambdas){
							if(err) {
								console.error(err)	
							} else {
								var existing = _.indexBy(lambdas.Functions, 'FunctionName')
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
	if( lambda.FunctionName in existing ) {
		return updateLambda(lambda)
	} else {
		return createLambda(lambda)
	}
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

handler({
	refs: "refs/branch/master",
	repository: {
		full_name: "JAForbes/dphoto-lambdas"
	}
}, { done: R.identity })

exports.handler = handler