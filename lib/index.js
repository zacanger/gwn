#!/usr/bin/env node

/* eslint-disable no-useless-escape */

const fs = require('fs')
const parseUrl = require('url-parse')
const path = require('path')
const { exec } = require('child_process')
const isDocker = require('is-docker')
const minimist = require('minimist')
const express = require('express')
const helmet = require('helmet')
const compression = require('compression')
const { isDirectory, isFile, mix } = require('zeelib')
const { error, respond, DEFAULT_HEADERS } = require('./utils')
const DeepRepo = require('./deep-repo')

const argv = minimist(process.argv.slice(2))
if (argv.r) argv.root = argv.r
if (argv.p) argv.port = argv.p

const config = mix({
  root: isDocker() ? '/repos' : process.cwd(),
  port: 9999,
  tar: 'tar',
  fastTimeout: 1400,
  logEntriesPerPage: 50
}, argv)

const isGitDir = (d) => isDirectory(path.resolve(config.root, d, '.git'))
const deepRepoInst = DeepRepo.create(config.root)
const downloadRex = /\/api\/([^\/`'"'&|<>]*)\.([tarzipgb2x\.]*)$/

// TODO: include tags and branches in basic repo info

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

  exec(cmd, opts, (err, stdout) => {
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
  let u = parseUrl(req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[portions.length - 2])
  let commit = portions[portions.length - 1]
  let dir = repo.location

  if (!isDirectory(dir)) {
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
  const proc = exec(cmdline, opts)
  proc.stdout.pipe(res)
}

const archive = (req, res) => {
  const u = parseUrl(req.url, true)
  const x = downloadRex.exec(u.pathname)
  const repo = x[1]
  const orepo = deepRepoInst.object(repo)
  const dir = orepo.location
  const branch = u.query.branch || 'HEAD' || 'master'
  let cmdline = `git archive --format=zip ${branch}`
  const contentType = 'application/zip'
  const opts = {
    cwd: dir,
    timeout: 24000,
    encoding: 'binary'
  }

  const tempfile = '/tmp/' +
    new Date().getTime() +
    '_' + repo +
    '-' +
    Math.random() +
    '.zip'

  cmdline += ' > ' + tempfile

  res.writeHead(200, {
    'content-type': contentType,
    'content-disposition': 'inline;filename=' + orepo.archive + '.' + 'zip'
  })

  exec(cmdline, opts, (err, stdout) => {
    if (err) {
      console.log(err)
    }

    const str = fs.createReadStream(tempfile)

    str.on('close', () => {
      fs.unlink(tempfile, (err) => {
        if (err) {
          console.error(err)
        }
      })
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
  let u = parseUrl(req.url, true)
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
  if (!isDirectory(dir)) {
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
  const proc = exec(cmdline, opts)
  res.writeHead(200, { 'Content-Type': contentType })
  proc.stdout.setEncoding('binary')
  proc.stdout.pipe(res)
}

function listFiles (req, res) {
  let u = parseUrl(req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[portions.length - 2])
  let dir = repo.location
  let branch = u.query.branch || 'HEAD' || 'master'

  if (!isDirectory(dir)) {
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
  exec(cmdline, opts, (err, stdout, stderr) => {
    if (err) {
      return error(req, res, err)
    }
    const split = (stdout + '').split('\n')
    let result = []
    for (var i = 0; i < split.length; i++) {
      let dta = split[i].split(/\s+/)
      if (/^([dwrxs-]{10})/.test(dta[0])) {
        let isFile = dta[0][0] !== 'd'
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
}

function log (req, res) {
  let u = parseUrl(req.url, true)
  let portions = u.pathname.split(/\//g)
  let repo = deepRepoInst.object(portions[portions.length - 1])
  let dir = repo.location
  if (!isDirectory(dir)) {
    return error(
      req,
      res,
      'No such repository ' + repo.name + '\n', 404
    )
  }

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

  gitCommits(dir, count, (err, commits) => {
    if (err) {
      return error(req, res, err)
    }
    respond(req, res, commits)
  }, skip)
}

function list (req, res) {
  // List repositories, with commit info
  if (req.method.toUpperCase() === 'HEAD') {
    res.writeHead(200, DEFAULT_HEADERS)
    return res.end()
  }

  const sortrepos = (a, b) =>
    a.name <= b.name ? -1 : 1

  function findrepos (dir, onDone) {
    let repos = []
    fs.readdir(dir, function (err, files) {
      if (err) {
        return onDone(err)
      }

      if (files.length === 0) {
        return onDone(null, repos)
      }

      function setImmediate (callback) {
        process.nextTick(callback)
      }

      function processFile () {
        if (files.length === 0) {
          return onDone(null, repos)
        }
        const file = files.pop()

        if (isGitDir(file)) {
          const fullpath = path.join(dir, file)
          fs.stat(fullpath, (err, stat) => {
            if (err) {
              console.error(err)
            }
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
  findrepos(config.root, (err, data) => {
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
      if (!isFile(descriptionFile)) {
        almostDone()
      } else {
        fs.readFile(descriptionFile, { encoding: 'utf8' }, (err, desc) => {
          if (err) {
            console.error(err)
          }

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
    }

    loadDescription()
  })
}

const app = express()
app.use(helmet())
app.use(compression())
app.use(express.static(__dirname))

// api routes
app.get('/api/list', list)
app.get(downloadRex, archive)
app.get(/\/api\/[^\/`'"'&|<>]*$/, log)
app.get(/\/api\/[^\/`'"'&|<>]*\/[abcdef1234567890]*$/, diff)
app.get(/\/api\/[^\/`'"'&|<>]*\/list$/, listFiles)
app.get(/\/api\/[^\/`'"'&|<>]*\/get\/([^&`'"|<>]*)/, getOneFile)

app.listen(config.port, () => {
  console.log(`gwn listening on ${config.port}`)
})
