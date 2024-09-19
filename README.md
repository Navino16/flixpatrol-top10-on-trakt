# Flixpatrol Top 10 on Trakt
[![GitHub License](https://img.shields.io/github/license/navino16/flixpatrol-top10-on-trakt?style=flat-square)](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/LICENSE)
[![Develop GitHub commits since latest release](https://img.shields.io/github/commits-since/navino16/flixpatrol-top10-on-trakt/latest/develop?label=Commits%20in%20Develop&style=flat-square)](https://github.com/navino16/flixpatrol-top10-on-trakt/tree/develop)
[![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/navino16/flixpatrol-top10-on-trakt?style=flat-square)](https://github.com/Navino16/flixpatrol-top10-on-trakt/issues)
[![GitHub Issues or Pull Requests](https://img.shields.io/github/issues-pr/navino16/flixpatrol-top10-on-trakt?style=flat-square)](https://github.com/Navino16/flixpatrol-top10-on-trakt/pulls)

[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/navino16/flixpatrol-top10-on-trakt/release.yml?branch=main&style=flat-square&label=Build%20(main))](https://github.com/Navino16/flixpatrol-top10-on-trakt/actions/workflows/release.yml?query=branch%3Amain++)
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/navino16/flixpatrol-top10-on-trakt/release.yml?branch=develop&style=flat-square&label=Build%20(develop))](https://github.com/Navino16/flixpatrol-top10-on-trakt/actions/workflows/release.yml?query=branch%3Adevelop++)

![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/navino16/flixpatrol-top10-on-trakt/total?style=flat-square)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/navino16/flixpatrol-top10-on-trakt?style=flat-square)](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases)
[![Static Badge](https://img.shields.io/badge/Docker-blue?style=flat-square&logo=docker&logoColor=black)](https://github.com/Navino16/flixpatrol-top10-on-trakt/pkgs/container/flixpatrol-top10-on-trakt)
[![Static Badge](https://img.shields.io/badge/Windows-blue?style=flat-square&logo=windows&logoColor=black)](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases)
[![Static Badge](https://img.shields.io/badge/Linux-blue?style=flat-square&logo=linux&logoColor=black)](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases)
[![Static Badge](https://img.shields.io/badge/macOS-blue?style=flat-square&logo=apple&logoColor=black)](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases)

This tool get TODAY top 10 from flixpatrol and push the result on trakt list (useful for syncing with Kometa)

⚠️ Running on your own risk of being IP banned from FlixPatrol

⚠️ Due to some limitation of Flixpatrol, we have to make a search of the movie/show title on trakt.
That search is sort by relevance by Trakt. We then get the first item on the list that have the same release year
that the wanted movie/show (it should be the first item it the list). If none is found we take the first one on the list. 
It can cause some bad matching but there is nothing we can do about that.⚠️

## Table of Content
<!-- TOC -->
* [Flixpatrol Top 10 on Trakt](#flixpatrol-top-10-on-trakt)
  * [Table of Content](#table-of-content)
  * [1. Getting Started](#1-getting-started)
    * [Linux / macOS](#linux--macos)
    * [Windows](#windows)
    * [Docker](#docker)
  * [2. Configuration](#2-configuration)
    * [Environment variable](#environment-variable)
    * [Configuration file](#configuration-file)
      * [Example file](#example-file)
    * [Trakt](#trakt)
<!-- TOC -->

## 1. Getting Started

### Linux / macOS

Note: I don't have any macOS device but the step should be the same as Linux.

To get started with Flixpatrol Top 10 on Trakt for Linux / macOS, follow these simple steps:

1. Create a directory where you want the tool and config file be stored and go in it
    ````shell
   mkdir flixpatrolTop10
   cd flixpatrolTop10
   ````
2. Download the [latest release](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases/latest) corresponding to the platform where your want to run this tool
    ````shell
    wget https://github.com/Navino16/flixpatrol-top10-on-trakt/releases/download/v2.4.1/flixpatrol-top10-linux
    ````
3. Make the downloaded binary executable
    ````shell
    chmod +x flixpatrol-top10-linux
    ````
4. Run the binary (it will create a directory with config file at first run next to the binary)
    ````shell
    ./flixpatrol-top10-linux
    ````
5. Edit the config file as you want. It's located in `./config/default.json`
6. You can now run the tool periodically with tool like cron

### Windows

To get started with Flixpatrol Top 10 on Trakt for Windows, follow these simple steps:

1. Create a directory where you want the tool and config file be stored and go in it
2. Download the [latest release](https://github.com/Navino16/flixpatrol-top10-on-trakt/releases/latest) corresponding to the platform where your want to run this tool
3. Run the binary (it will create a directory with config file at first run next to the binary)
   1. If you just double-click the executable the window will automatically close.
   To avoid this you can launch the executable with command line
4. Edit the config file as you want. It's located in `./config/default.json`
5. You can now run the tool periodically with tool like Task Scheduler

### Docker

To get started with Flixpatrol Top 10 on Trakt for Docker, follow these simple steps:

1. Create a directory where you want the config files to be stored in
2. Run docker (it will create the config file inside your directory)
    ````shell
   docker run --rm -v "/some/path/flixpatrol-top10/config/:/app/config" ghcr.io/navino16/flixpatrol-top10-on-trakt:latest
   ````
3. Edit the config file as you want
4. You can now run the tool periodically with tool like cron

## 2. Configuration

### Environment variable
You can pass some environment variables to the tool:

| Name      | Descriptions                | Values                   | Default | 
|-----------|-----------------------------|--------------------------|---------|
| LOG_LEVEL | How verbose the log will be | error, warn, info, debug | info    |

### Configuration file
The configuration file should be stored in a directory named `config` next to the binary.
It should be named `default.json`.

At first run a default configuration file will be generated with some top10 preconfigured, so you can see the file format. Feel free to edit it.

If there is any configuration error, the tool will exit whit information about the error.

| Name                               | Descriptions                                                                                                                           | Mandatory | Values                                                                                                                                          | Default                                      |
|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| FlixPatrolTop10                    | An array containing as much as you want top10Config                                                                                    | Yes       |                                                                                                                                                 |                                              |
| top10Config.platform               | Which platform to get from Flixpatrol                                                                                                  | Yes       | Any Flixpatrol platform ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L48))          |                                              |
| top10Config.location               | Which location to get from Flixpatrol                                                                                                  | Yes       | Any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L22))          |                                              |
| top10Config.fallback               | If there is no show/movie found, should we fallback to another location?                                                               | Yes       | False or any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L22)) | false                                        |
| top10Config.privacy                | The privacy of the generated Trakt list                                                                                                | Yes       | private, public                                                                                                                                 | private                                      |
| top10Config.limit                  | How many movie/show we should get from Flixpatrol                                                                                      | Yes       | Number between 1 and 10 (included)                                                                                                              | 10                                           |
| top10Config.type                   | Do you want movies, shows or both ?                                                                                                    | Yes       | movies, shows, both                                                                                                                             | both                                         |
| top10Config.name                   | Optional name of the list                                                                                                              | No        | Any valid string                                                                                                                                | A generated name based on the top10 config   |
| FlixPatrolPopular                  | An array containing as much as you want popularConfig                                                                                  | Yes       |                                                                                                                                                 |                                              |
| popularConfig.platform             | Which popular platform to get from Flixpatrol                                                                                          | Yes       | Any Flixpatrol popular platform ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L53))  |                                              |
| popularConfig.privacy              | The privacy of the generated Trakt list                                                                                                | Yes       | private, public                                                                                                                                 | private                                      |
| popularConfig.limit                | How many movie/show we should get from Flixpatrol                                                                                      | Yes       | Number between 1 and 100 (included)                                                                                                             | 100                                          |
| popularConfig.type                 | Do you want movies, shows or both ?                                                                                                    | Yes       | movies, shows, both                                                                                                                             | both                                         |
| popularConfig.name                 | Optional name of the list                                                                                                              | No        | Any valid string                                                                                                                                | A generated name based on the popular config |
| FlixPatrolMostWatched              | An array containing as much as you want flixPatrolMostWatched                                                                          | Yes       |                                                                                                                                                 |                                              |
| flixPatrolMostWatched.enabled      | Do you want to get a most watched list ?                                                                                               | Yes       | true, false                                                                                                                                     | true                                         |
| flixPatrolMostWatched.privacy      | The privacy of the generated Trakt list                                                                                                | Yes       | private, public                                                                                                                                 | private                                      |
| flixPatrolMostWatched.type         | Do you want movies, shows or both ?                                                                                                    | Yes       | movies, shows, both                                                                                                                             | both                                         |
| flixPatrolMostWatched.limit        | How many movie/show we should get from Flixpatrol                                                                                      | Yes       | Number between 1 and 50 (included)                                                                                                              | 50                                           |
| flixPatrolMostWatched.year         | Year of the most watched list                                                                                                          | Yes       | Number between 2023 current year (included)                                                                                                     | 50                                           |
| flixPatrolMostWatched.name         | Optional name of the list                                                                                                              | No        | Any valid string                                                                                                                                | most-watched                                 |
| flixPatrolMostWatched.premiere     | Year of movie/show release. It will only return most watched movies/shows of this year. If omitted, all movie/shows are returned       | No        | Year between 1980 and current year (included)                                                                                                   | All                                          |
| flixPatrolMostWatched.country      | Release country of movie/show. It will only return most watched movies/shows of this country. If omitted, all movie/shows are returned | No        | Any Flixpatrol location ([see this](https://github.com/Navino16/flixpatrol-top10-on-trakt/blob/main/src/Flixpatrol/FlixPatrol.ts#L22))          | All                                          |
| flixPatrolMostWatched.original     | Return only movie/show created by Netflix. If omitted, all movie/shows are returned                                                    | No        | true, false                                                                                                                                     | false                                        |
| flixPatrolMostWatched.orderByViews | Order list by views. By default ordered by hours                                                                                       | No        | true, false                                                                                                                                     | false                                        |
| Trakt.saveFile                     | Where to save the Trakt session file                                                                                                   | Yes       | Any valid path                                                                                                                                  | ./config/.trakt                              |
| Trakt.clientId                     | You clientId from Trakt ([here](https://trakt.tv/oauth/applications/new) to get a new one)                                             | Yes       | A valid traktId                                                                                                                                 |                                              |
| Trakt.clientSecret                 | You clientSecret from Trakt ([here](https://trakt.tv/oauth/applications/new) to get a new one)                                         | Yes       | A valid clientSecret                                                                                                                            |                                              |
| Cache.enabled                      | Do you want to use cache? (You should)                                                                                                 | Yes       | true, false                                                                                                                                     | true                                         |
| Cache.savePath                     | Where to save the caches files                                                                                                         | Yes       | Any valid path                                                                                                                                  | ./config/.cache                              |
| Cache.ttl                          | How long the cache will be valid in seconds                                                                                            | Yes       | Any number greater than 0                                                                                                                       | 604800                                       |

#### Example file
````json
{
  "FlixPatrolTop10": [
    {
      "platform": "netflix",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Netflix Top 10 Movies",
      "type": "movies"
    },
    {
      "platform": "disney",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Disney Plus Top 10 Shows",
      "type": "shows"
    },
    {
      "platform": "amazon-prime",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "name": "Amazon Prime Top 10",
      "type": "both"
    },
    {
      "platform": "apple-tv",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "type": "both"
    },
    {
      "platform": "paramount-plus",
      "location": "world",
      "fallback": false,
      "privacy": "private",
      "limit": 10,
      "type": "both"
    }
  ],
  "FlixPatrolPopular": [
    {
      "platform": "movie-db",
      "privacy": "private",
      "limit": 100
    }
  ],
  "FlixPatrolMostWatched": {
    "enabled": true,
    "privacy": "public",
    "limit": 50,
    "type": "both"
  },
  "Trakt": {
    "saveFile": "./config/.trakt",
    "clientId": "You need to replace this client ID",
    "clientSecret": "You need to replace this client secret"
  },
  "Cache": {
    "enabled": true,
    "savePath": "./config/.cache",
    "ttl": 604800
  }
}
````

### Trakt

To run this application you need to have a Trakt account and a Client ID / Client Secret.

⚠️ Trakt is limited to 5 list on free account, if you specified more than 5 platform on config the script will fail.
Remove some platform from the config or take a VIP account on Trakt

1. Go [here to create a new one](https://trakt.tv/auth/join) or [here to login](https://trakt.tv/login).
2. [Create a new application](https://trakt.tv/oauth/applications/new) on your Trakt account
   1. Name: what ever you want
   2. Icon: not needed
   3. Description: not needed
   4. Redirect uri: urn:ietf:wg:oauth:2.0:oob
   5. Javascript (cors) origins: not needed
   6. Permissions: none
3. Set the given Client ID / Client Secret on the configuration file
4. Run the app and follow the instructions
