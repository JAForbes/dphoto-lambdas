var R = require("ramda")

require('./handler').handler({
	refs: "refs/branch/master",
	repository: {
		full_name: "JAForbes/dphoto-lambdas"
	}
}, { done: R.identity })
