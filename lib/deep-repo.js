const path = require('path')

const DeepRepo = (exports.DeepRepo = (function () {
  const PROTOTYPE = function (globalpath) {
    function objectfromPath(repopath) {
      const dir = repopath.replace(globalpath + '/', '')
      const name = dir
      return {
        location: repopath,
        dir: dir,
        name: name,
        id: name.replace(/\//g, '+'),
        archive: name.replace(/\//g, '-'),
      }
    }

    function objectfromID(id) {
      const name = id.replace(/\+/g, '/')
      const dir = name
      return {
        location: path.join(globalpath, dir),
        dir: dir,
        name: name,
        id: id,
        archive: name.replace(/\//g, '-'),
      }
    }

    this.object = function (pathOrID) {
      if (pathOrID.includes(globalpath)) {
        return objectfromPath(pathOrID)
      }
      return objectfromID(pathOrID)
    }
  }

  return {
    create: function (globalpath) {
      return new PROTOTYPE(globalpath)
    },
  }
})())

module.exports = DeepRepo
