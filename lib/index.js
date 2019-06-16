#!/usr/bin/env node

const http = require('http')
const fs = require('fs')
const util = require('util')
const url = require('url')
const path = require('path')
const child_process = require('child_process')
const { isDirectory } = require('zeelib')
const error = require('./utils').error
const respond = require('./utils').respond
const DEFAULT_HEADERS = require('./utils').DEFAULT_HEADERS
const Router = require('./router')
const DeepRepo = require('./deep-repo')

const file = 'gwn.json'
const filepath = path.resolve(__dirname, file)
const DEFAULT_COUNT = 30

// TODO: get rid of this config file and use flags instead
const config = {
  gitdir: '/home/z/Downloads',
  port: 9902,
  tar: 'tar',
  fastTimeout: 1400,
  logEntriesPerPage: DEFAULT_COUNT,
  serveIndexPage: true,
  failOnNoDir: true,
  blacklist: [],
  whitelist: [],
  listfilter: ''
}

const isGitDir = (d) =>
  isDirectory(path.resolve(config.gitdir, d, '.git'))

// Look for a file named gwn.json in the process working dir, and
// if present, override config defaults with its contents
if (fs.existsSync(filepath)) {
  const loaded = JSON.parse(fs.readFileSync(filepath, { encoding: 'utf8' }))
  for (const key in loaded) {
    config[key] = loaded[key]
  }
}

// Note: When the string is empty,
// split returns an array containing one empty string,
// rather than an empty array.
if (config.whitelist[0] === '') {
  config.whitelist.pop()
}

// check config.listfilter value
if (!/^(blacklist|whitelist)$/.test(config.listfilter)) {
  // try autodetection - blacklist takes precedence over whitelist for backwards compatibility
  config.listfilter = config.whitelist.length > 0 &&
    config.blacklist.length <= 1 ? 'whitelist' : 'blacklist'
}

// in case of whitelist we need to allow deep search
if (/whitelist/.test(config.listfilter)) {
  let parts = []
  config.whitelist.forEach((path) => {
    let chunk = path.split(/\//)
    let buildpath = ''
    chunk.pop()
    for (let i = 0, l = chunk.length; i < l; i++) {
      buildpath += (i > 0 ? '/' : '') + chunk[i]
      if (parts.indexOf(buildpath) < 0) {
        parts.push(buildpath)
      }
    }
  })
  config.whitelist = config.whitelist.concat(parts)
}

// Bail out early if gitdir is not set, or if failOnNoDir is true and the
// dir does not exist
if (!config.gitdir || (config.failOnNoDir && !fs.existsSync(config.gitdir))) {
  throw new Error("Git dir does not exist: '" + config.gitdir + "'")
}

const deepRepoInst = DeepRepo.create(config.gitdir)

const listFileRex = /\/git\/[^\/`'"'&|<>]*\/get\/([^&`'"|<>]*)/
const downloadRex = /\/git\/([^\/`'"'&|<>]*)\.([tarzipgb2x\.]*)$/

// TODO: replace all this junk with koa or micro
const router = new Router()

// Redirects to the UI home page
router.getAndHead('', redir)
router.getAndHead('/', redir)
router.getAndHead(/\/git$/, redir)

// Static content
if (config.serveIndexPage) {
  router.getAndHead(/\/git\/index.html/, getFile('index.html'), 'Index page')
  router.getAndHead(/\/git\/?$/, getFile('index.html'), 'Index page')
}
// Web API
router.getAndHead('/git/list', list, 'List repositories')
router.getAndHead(downloadRex, archive, 'Fetch an archive of a repository')
router.getAndHead(/\/git\/[^\/`'"'&|<>]*$/, log, 'Fetch log for one repository')
router.getAndHead(/\/git\/[^\/`'"'&|<>]*\/[abcdef1234567890]*$/, diff, 'Fetch a change set')
router.getAndHead(/\/git\/[^\/`'"'&|<>]*\/list$/, listFiles, 'List files')
router.getAndHead(listFileRex, getOneFile, 'List files')

// Start the server
router.createSimpleServer(config.port, function onStart (err) {
  if (err) throw err
  console.log('Started git server on ' + config.port + ' over ' + config.gitdir)
})

// Redirect requests to the site root
function redir (req, res) {
  res.writeHead(302, {
    Location: '/git/'
  })
  res.end('Redirecting to git server root')
}

// Web API calls:
function getFile (file) {
  let dir = path.dirname(module.filename)
  let pth = path.join(dir, file)
  if (!fs.existsSync(pth)) {
    throw new Error(pth + ' does not exist')
  }
  let contentType = guessContentType(pth)
  return function serveFile (req, res) {
    fs.stat(pth, (err, stat) => {
      if (err) {
        return error(req, res, err)
      }
      if (req.headers['if-modified-since']) {
        let date = new Date(req.headers['if-modified-since'])
        if (date <= mtime) {
          res.writeHead(304)
          return res.end()
        }
      }
      var mtime = stat.mtime
      let stream = fs.createReadStream(pth)
      let hdrs = {
        'Content-Type': contentType,
        'Last-Modified': mtime
      }
      if (/image/.test(contentType) || /javascript/.test(contentType)) {
        let expires = new Date()
        expires.setFullYear(expires.getFullYear() + 10)
        hdrs['Expires'] = expires
        hdrs['Cache-Control'] = 'public, max-age=600000'
      } else {
        hdrs['Cache-Control'] = 'public, must-revalidate'
      }
      res.writeHead(200, hdrs)
      stream.pipe(res)
    })
  }
}

// PENDING: include tags and branches in basic repo info

function copy (arr) {
  let result = []
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i])
  }
  return result
}

function gitCommits (pth, n, cb, skip) {
  // The terrifying ^@^ delimiter is so that we can escape quotes safely,
  // after which we can replace them with quotes.  If anybody actually uses
  // this sequence in a commit message, well, it will be a weird hack.

  let skipArg = ''
  if (skip) {
    skipArg = ' --skip=' + skip + ' '
  }

  // Basically we're getting `git log` to return pseudo-JSON
  let cmd = 'git log -n' + n + ' --branches=* ' + skipArg +
    ' --pretty=format:\'{%n^@^hash^@^:^@^%h^@^,%n^@^author^@^:^@^%an^@^,%n^@^date^@^:^@^%ad^@^,%n^@^email^@^:^@^%aE^@^,%n^@^message^@^:^@^%s^@^,%n^@^commitDate^@^:^@^%ai^@^,%n^@^age^@^:^@^%cr^@^},\''
  let opts = {
    cwd: pth,
    timeout: config.fastTimeout
  }

  child_process.exec(cmd, opts, (err, stdout) => {
    if (err) {
      return cb(err)
    }

    let out = ('' + stdout)
      .replace(/\\/g, '\\\\')
      .replace(/"/gm, '\\"')
      .replace(/\^@\^/gm, '"')
      .replace(/[\f\r\n]/g, '')

    if (out[out.length - 1] === ',') {
      out = out.substring(0, out.length - 1)
    }
    out = '[' + out + ']'
    try {
      let parsed = JSON.parse(out)
      for (let i = 0; i < parsed.length; i++) {
        if (parsed[i].date) {
          parsed[i].date = new Date(Date.parse(parsed[i].date))
        }
      }
      cb(null, parsed)
    } catch (err) {
      cb(err, out)
    }
  })
}

function diff (req, res) {
  let u = url.parse(req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[portions.length - 2])
  let commit = portions[portions.length - 1]
  let dir = repo.location
  fs.exists(dir, (exists) => {
    if (!exists) {
      return error(
        req,
        res,
        'No such repository ' + repo.name + '\n', 404
      )
    }
    const opts = {
      cwd: dir,
      timeout: config.fastTimeout
    }
    const cmdline = 'git diff-tree --patch-with-stat "' + commit + '"'
    const expires = new Date()
    // Set expiration date 10 years in the future - a commit will always
    // match its hash
    expires.setFullYear(expires.getFullYear() + 10)
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=UTF-8',
      Expires: expires,
      'Cache-Control': 'public'
    })
    const proc = child_process.exec(cmdline, opts)
    proc.stdout.pipe(res)
  })
}

// TODO: this function is terrible
// also maybe only include tar.gz, or only include zip
function archive (req, res) {
  let u = url.parse(req.url, true)
  let x = downloadRex.exec(u.pathname)
  let repo = x[1]
  if (/(.*)\.tar/.test(repo)) {
    repo = /(.*?)\.tar/.exec(repo)[1]
  }
  // Do a little hack to pipe it through xz or bz2, so we can
  // support those target formats
  let orepo = deepRepoInst.object(repo)
  let dir = orepo.location
  let branch = u.query.branch || 'HEAD' || 'master'
  let fmt = x[2]
  let format = 'tar'
  let cmdline = 'git archive --format='
  let postProcess = ''
  let contentType = 'application/x-tar'
  switch (fmt) {
    case 'tar' :
      break
    case 'zip' :
      format = 'zip'
      contentType = 'application/zip'
      break
    case 'gz' :
      format = 'tar.gz'
      contentType = 'application/x-gtar'
      break
    case 'bz2' :
      postProcess = ' | bzip2 -9c'
      contentType = 'application/x-gtar'
      break
    case 'xz' :
      postProcess = ' | xz -9c'
      contentType = 'application/x-xz'
      break
    default :
      return error(req, res, 'Unknown format ' + fmt, 400)
  }
  cmdline += format + ' ' + branch + postProcess
  const opts = {
    cwd: dir,
    timeout: 24000,
    encoding: 'binary'
  }
  console.log(opts.cwd)
  // XXX for some reason, when piping the process output directly to the
  // http response, the result ends up truncated.  For now use a temporary
  // file and serve that
  const tempfile = '/tmp/' + new Date().getTime() + '_' + repo + '-' + Math.random() + '.' + format
  cmdline += ' > ' + tempfile
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': 'inline;filename=' + orepo.archive + '.' + format
  })
  const proc = child_process.exec(cmdline, opts, (err, stdout) => {
    if (err) {
      console.log(err, opts)
    }
    const str = fs.createReadStream(tempfile)
    str.on('close', () => {
      fs.unlink(tempfile)
    })
    str.pipe(res)
  })
}

// TODO: this is disgusting
function guessContentType (pth) {
  let contentType = 'application/octet-stream'
  const rex = /.*\.(.*)/
  if (rex.test(pth)) {
    switch (rex.exec(pth.toLowerCase())[1]) {
      case 'js' :
        contentType = 'application/javascript; charset=utf8'
        break
      case 'woff' :
        contentType = 'font/woff'
        break
      case 'ttf' :
        contentType = 'font/ttf'
        break
      case 'gif' :
        contentType = 'image/gif'
        break
      case 'png' :
        contentType = 'image/png'
        break
      case 'jpg' :
      case 'jpeg' :
        contentType = 'image/jpeg'
        break
      case 'html' :
        contentType = 'text/html; charset=utf8'
        break
      case 'css' :
        contentType = 'text/css; charset=utf8'
        break
      case 'json' :
        contentType = 'application/json; charset=utf8'
        break
      case 'zip' :
        contentType = 'application/zip'
        break
      case 'xz' :
        contentType = 'application/x-xz'
        break
      case 'jar' :
        contentType = 'application/jar'
        break
      case 'bz2' :
        contentType = 'application/x-bzip2'
        break
      case 'gz' :
        contentType = 'application/x-gzip'
        break
      default:
        contentType = 'text/plain'
    }
  }

  return contentType
}

function getOneFile (req, res) {
  // Use git show to list the file - we never actually unpack it to disk,
  // just read the index
  let self = this
  let u = url.parse(self.req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[2])
  let dir = repo.location
  let pth = ''
  let raw = u.query.raw
  let branch = u.query.branch || 'HEAD' || 'master'
  for (let i = 4; i < portions.length; i++) {
    if (pth.length > 0) {
      pth += '/'
    }
    pth += portions[i]
  }
  fs.exists(dir, (exists) => {
    if (!exists) {
      return error(
        req,
        res,
        'No such repository ' + repo.name + '\n', 404
      )
    }
    const opts = {
      cwd: dir,
      timeout: config.fastTimeout
    }
    let contentType = 'text/plain; charset=UTF-8'
    if (raw || /.*\.gif/.test(pth) || /.*\.png/.test(pth) || /.*\.jpg/.test(pth)) {
      var rex = /.*\.(.*)/
      if (rex.test(pth)) {
        contentType = guessContentType(pth)
      }
    }
    const cmdline = 'git show --format=raw "' + branch + ':' + pth + '"'
    const proc = child_process.exec(cmdline, opts)
    self.res.writeHead(200, { 'Content-Type': contentType })
    proc.stdout.setEncoding('binary')
    proc.stdout.pipe(res)
  })
}

function listFiles (req, res) {
  let self = this
  let u = url.parse(self.req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[portions.length - 2])
  let dir = repo.location
  let branch = u.query.branch || 'HEAD' || 'master'
  let rex = /([dwrxs-]{10})\s+(\S+)\s+(\d+)\s+([\d-]+)\s+([\d:-]+)\s+(.*)$/gm
  fs.exists(dir, (exists) => {
    if (!exists) {
      return error(
        req,
        res,
        'No such repository ' + repo.name + '\n', 404
      )
    }
    var opts = {
      cwd: dir,
      timeout: config.fastTimeout
    }
    // PENDING:  This is pretty horribly inefficient, since we're archiving
    // the entire repo in order to list it - find another way
    const cmdline = 'git archive "' + branch + '"| ' + config.tar + ' -tv'
    child_process.exec(cmdline, opts, (err, stdout, stderr) => {
      if (err) {
        return error(req, res, err)
      }
      const split = (stdout + '').split('\n')
      let result = []
      for (var i = 0; i < split.length; i++) {
        let dta = split[i].split(/\s+/)
        if (/^([dwrxs-]{10})/.test(dta[0])) {
          let isFile = dta[0][0] != 'd'
          let name = dta[5].split(/\//gm)
          if (name && name.length > 0) {
            name = name[name.length - 1]
          } else {
            name = dta[5]
          }
          if (isFile) {
            const item = {
              type: dta[0],
              name: name,
              //                        owner: dta[1],
              size: parseInt(dta[2]),
              date: new Date(Date.parse(dta[3] + ' ' + dta[4])), // XXX timezone
              //                        date: dta[3],
              //                        time: dta[4],
              path: dta[5]
            }
            result.push(item)
          }
        }
      }

      respond(req, res, result)
    })
  })
}

function log (req, res) {
  let self = this
  let u = url.parse(self.req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[portions.length - 1])
  let dir = repo.location
  fs.exists(dir, (exists) => {
    let skip = null
    let count = config.logEntriesPerPage
    if (typeof u.query.skip !== 'undefined') {
      skip = parseInt(u.query.skip)
      if (skip + '' === 'NaN') {
        return respond(
          req,
          res,
          'Not a number: ' + u.query.skip + '\n'
        )
      }
    }
    if (typeof u.query.count !== 'undefined') {
      count = parseInt(u.query.count)
      if (count + '' === 'NaN') {
        return respond(
          req,
          res,
          'Not a number: ' + u.query.count + '\n'
        )
      }
    }
    if (!exists) {
      return error(
        req,
        res,
        'No such repository ' + repo.name + '\n', 404
      )
    }
    gitCommits(dir, count, (err, commits) => {
      if (err) {
        return error(req, res, err)
      }
      respond(req, res, commits)
    }, skip)
  })
}

function list (req, res) {
  // List repositories, with commit info
  if (req.method.toUpperCase() === 'HEAD') {
    res.writeHead(200, DEFAULT_HEADERS)
    return res.end()
  }

  function isListable (dir, relpath) {
    const list = config[config.listfilter]
    if (/blacklist/.test(config.listfilter)) {
      return list && list.length > 0
        ? list.indexOf(dir) < 0 && list.indexOf(relpath) < 0
        : true
    }

    return list && list.length > 0
      ? list.indexOf(dir) >= 0 || list.indexOf(relpath) >= 0
      : false
  }

  function sortrepos (a, b) {
    return a.name <= b.name ? -1 : 1
  }

  function findrepos (dir, onDone) {
    let repos = []
    fs.readdir(dir, function (err, files) {
      if (err) {
        return onDone(err)
      }

      if (files.length == 0) {
        return onDone(null, repos)
      }

      function setImmediate (callback) {
        process.nextTick(callback)
      }

      function processFile () {
        if (files.length == 0) {
          return onDone(null, repos)
        }
        const file = files.pop()

        const relativepath = (
          dir.replace(config.gitdir, '') + '/' + file
        ).replace(/^\//, '')

        if (isListable(file, relativepath)) {
          const fullpath = path.join(dir, file)
          fs.stat(fullpath, (err, stat) => {
            if (isGitDir(file)) {
              repos.push(deepRepoInst.object(fullpath))
              setImmediate(processFile)
            }
          })
        } else {
          setImmediate(processFile)
        }
      }
      setImmediate(processFile)
    })
  }

  // List all subdirs of the git dir
  findrepos(config.gitdir, (err, data) => {
    if (err) {
      return error(req, res)
    }

    if (data.length === 0) {
      return respond(req, res, [])
    }

    // sort data in alphabetically ascendant order
    data.sort(sortrepos)

    // clone the data
    let moreData = copy(data)

    let handled = 0
    function loadDescription () {
      // Called iteratively - get the current item
      const item = moreData.pop()

      const descriptionFile = item
        ? path.join(item.location, 'description')
        : ''

      function done () {
        if (++handled >= data.length) {
          respond(req, res, data)
        } else {
          process.nextTick(loadDescription)
        }
      }

      function almostDone () {
        // get the most recent commit for this repo
        gitCommits(item.location, 1, (err, commit) => {
          if (commit) {
            item.lastCommit = commit[0]
          } else if (err) {
            console.log(err)
          }
          done()
        })
      }

      // load the description
      fs.exists(descriptionFile, (exists) => {
        if (!exists) {
          almostDone()
        } else {
          fs.readFile(descriptionFile, { encoding: 'utf8' }, (err, desc) => {
            if (desc) {
              for (let i = 0; i < data.length; i++) {
                if (data[i].name === item.name) {
                  data[i].description = desc
                  break
                }
              }
            }
            almostDone()
          })
        }
      })
    }

    loadDescription()
  })
}
