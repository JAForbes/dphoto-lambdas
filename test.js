var _ = require("lodash")

require('./handler').handler({
	refs: "refs/branch/master",
	repository: {
		full_name: "JAForbes/dphoto-lambdas"
	}
}, { done: _.identity })
