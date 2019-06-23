# gwn

WIP

Like GitWeb, but Node

[![CircleCI](https://circleci.com/gh/zacanger/gwn.svg?style=svg)](https://circleci.com/gh/zacanger/gwn) ![Docker Pulls](https://img.shields.io/docker/pulls/zacanger/gwn.svg)

--------

## Installation

`npm i -g gwn`

## Usage

```shell
gwn -r path-to-repos-root -p port
# example
gwn -r ~/dev -p 8000
# root defaults to cwd
# port defaults to 9999
```

## Docker

`docker run -it -p 9999:9999 -v /path/to/repos:/repos zacanger/gwn`

Check out the [repo](https://hub.docker.com/r/zacanger/gwn).

## Alternatives

* [GitWeb](https://git-scm.com/book/en/v2/Git-on-the-Server-GitWeb) — it's built
  in, but it's a CGI script written in Perl, which is not a language I love.
* [cgit](https://git.zx2c4.com/cgit/) — fast, but still quite complicated, and
  written in C, which is not very approachable.
* [Klaus](https://github.com/jonashaag/klaus) — simple, written in a good
  language (Python), well-maintained. If I didn't want to write my own, I'd be
  using this.

## TODO

* Make it good (see all the TODOs in the code)

## Credits

Some code based on [this project](https://github.com/timboudreau/gittattle).

## License

[MIT](./LICENSE.md)
