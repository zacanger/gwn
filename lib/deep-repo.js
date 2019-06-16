const path = require('path')

const DeepRepo = exports.DeepRepo = (function () {
  var PROTOTYPE = function (globalpath) {
    function objectfromPath (repopath) {
      var dir = repopath.replace(globalpath + '/', '')
      var name = dir
      return {
        location: repopath,
        dir: dir,
        name: name,
        id: name.replace(/\//g, '+'),
        archive: name.replace(/\//g, '-')
      }
    }

    function objectfromID (id) {
      var name = id.replace(/\+/g, '/')
      var dir = name
      return {
        location: path.join(globalpath, dir),
        dir: dir,
        name: name,
        id: id,
        archive: name.replace(/\//g, '-')
      }
    }

    this.object = function (pathOrID) {
      if (pathOrID.indexOf(globalpath) > -1) {
        return objectfromPath(pathOrID)
      }
      return objectfromID(pathOrID)
    }
  }

  return {
    create: function (globalpath) {
      return new PROTOTYPE(globalpath)
    }
  }
}
)()

module.exports = DeepRepo
