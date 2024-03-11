# Flixpatrol Top 10 on Trakt

This tool get TODAY top 10 from flixpatrol and push the result on trakt list (useful for syncing with PMM)

⚠️ Running on your own risk of being IP banned from FlixPatrol

⚠️ Due to some limitation of Flixpatrol, we have to make a search of the movie/show title on trakt.
We always take the first result from Trakt, and it can cause some bad matching but there is nothing we can do about that.

Available platform :
* netflix
* hbo
* disney
* amazon
* amazon-prime
* apple-tv
* chili
* freevee
* google
* hulu
* itunes
* osn
* paramount-plus
* rakuten-tv
* shahid
* star-plus
* starz
* viaplay
* vudu

Almost all language are available (see in src/Flixpatrol/FlixPatrol.ts).

⚠️ If the script can't get the top 10 for the specified language it will fallback to world top 10

All configurations are made in config/default.json

⚠️ Trakt is limited to 5 list on free account, if you specified more than 5 platform on config the script will fail.
Remove some platform from the config or take a VIP account on Trakt
