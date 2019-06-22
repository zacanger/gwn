# gwn

WIP

Like GitWeb, but Node

[![CircleCI](https://circleci.com/gh/zacanger/gwn.svg?style=svg)](https://circleci.com/gh/zacanger/gwn)

--------

## Why?

* What's wrong with GitWeb?
  * It's written in Perl which is great if you like Perl and not so great if you
    don't. Also it expects to be behind Apache.
* What's wrong with cgit?
  * It's written in C which is greate if you like C and not so great if you
    don't. Also it expects to be behind Apache.

I wanted a simple, read-only Git repository viewer written in a language I like.
I like a lot of languages, but I especially like working in Node.

[Klaus](https://github.com/jonashaag/klaus) is pretty close to what I was
looking for (small, read-only, simple, written in a pleasant language), but by
the time I found it I'd already decided to write my own.

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

## TODO

* Make it good (see TODOs in the code)

## Credits

Initial code based on [this project](https://github.com/timboudreau/gittattle).

## License

[MIT](./LICENSE.md)
