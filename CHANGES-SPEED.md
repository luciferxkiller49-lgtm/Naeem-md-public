# Speed / lite update

## Code
- `lib/mongoAuth.js` — Signal keys ab RAM mein foran update hoti hain aur Mongo mein ek batch (default 1.5s, `KEYS_FLUSH_MS`) mein likhi jati hain.
  Pehle har message/reply Atlas ke round-trip ka intezar karta tha. SIGTERM par foran flush; reconnect par purana pending flush pehle likha jata hai; logout (`deleteSession`) pending flush cancel karta hai.
  Purane instances ke closures ab RAM mein jama nahi hote.
- `bot.js` — ek upsert ke SAARE messages process hote hain (pehle sirf pehla). 90s se purane messages skip (`MAX_MSG_AGE_SEC`, 0 = band).
  Group metadata sirf tab mangi jati hai jab message command ho ya group mein koi anti-feature ON ho.
- `lib/limiter.js` — ffmpeg ek waqt mein max 2 (`FFMPEG_CONCURRENCY`). Sticker/audio temp file names ab unique. ffmpeg install na ho to ek saaf error log aata hai.
- `lib/safety.js` — cooldown Map ab barhta nahi.
- `Procfile` — `--max-old-space-size=400` (512MB dyno ke liye).
- `package.json` — `@hapi/boom` add, Node 20.x pin, unused `fluent-ffmpeg` + `qrcode-terminal` hata diye.

## Hataya gaya (kabhi chalta hi nahi tha)
- Root ki purani copies `mongoAuth.js`, `reconnect.js` (bot `lib/` wali use karta hai).
- 23 duplicate command definitions jo loader pehle hi skip karta tha (commands/moderation.js poora khali tha, delete; antidelete, antiedit, antilink, roast, joke, quote, kick, promote, demote, mute, unmute, gcstatus, hack, status, antistatus, welcome, goodbye, weather, translate) aur 2 dead aliases (`status`, `calc`).
  Command list pehle jaisi hi hai: 198 commands, 93 aliases. Ab startup par 23 collision warnings nahi aati.

## Heroku par ek baar karna hai
- ffmpeg buildpack (sticker/audio ke liye): `heroku buildpacks:add --index 1 https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest -a <app>`
- Heroku aur Atlas ka region ek hi rakhein.
