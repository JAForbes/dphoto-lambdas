Shepherd
========

Deploys your lambdas when you git push.
---------------------------------------

- Responds to Github Webhook
- Automatically deploys latest services on master branch
- Specify your web service(s) by adding a `lambdas.json` to the root of your repo

Getting Started
---------------

#### Via CLI

__documentation coming soon__

#### Via Github hook

__documentation coming soon__

Limitations
-----------

- Must include your node_modules in source control
- Your handlers must be in the root directory (but you can have as many as you like)
- If you have a lot of dependencies the deploy may fail ( max timeout on lambda is 60 secs)

If you update your npm to version 3, the node modules tree will be aggressively flattened and will remove shared dependencies.
This can increase build time.

You could also be clever and use webpack and uglify to shrink your repo size.  Ultimately the size of your repo is the largest bottleneck.
But these are meant to be _micro_ services right?

How it works
------------

When you push your code to master, github sends a [push event](https://developer.github.com/v3/activity/events/types/#pushevent) to a server instructing Amazon
to deploy your repo has a lambda web service.

It will grab the latest `zip` of your master branch and upload it to an S3 bucket
that you specify.  It then creates / updates the lambda functions source code to reference
a file within that newly uploaded zip

Example `lambdas.json`
----------------------

```js
{
  "bucket": "lambda-bucket", //where to save the zip
  "bucket_key": "services.zip", //what to save the zip as
  "region": "us-west-2", //the region that your bucket and lambdas share
  
  //a list of web services
  "lambdas": [
    {
	  // Configuration of lambda service is consistent with the AWS SDK parameters
	  // See http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html#createFunction-property
      "FunctionName": "a",
      "Handler": "a.handler",
      "Role": "arn:aws:iam::285966843427:role/APIGatewayLambdaExecPolicy",
      "Runtime": "nodejs",
      "Description": " {\"Hello\":\", a user-provided string, and \"} "
    },
    {
      "FunctionName": "b",
      "Handler": "b.handler",
      "Role": "arn:aws:iam::285966843427:role/APIGatewayLambdaExecPolicy",
      "Runtime": "nodejs",
      "Description": " {\"Hello\":\", a user-provided string, and \"} "
    },
    {
      "FunctionName": "c",
      "Handler": "c.handler",
      "Role": "arn:aws:iam::285966843427:role/APIGatewayLambdaExecPolicy",
      "Runtime": "nodejs",
      "Description": " {\"Hello\":\", a user-provided string, and \"} "
    }
  ]
}
```