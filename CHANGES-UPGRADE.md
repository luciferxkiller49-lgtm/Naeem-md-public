# Upgrade: Katabump commands + menu + channel

New files: commands/kb-*.js, lib/uptime.js, lib/channel.js
Changed: bot.js (ctx extras, ban/sudo/away/afk/autoreact/antistatus/statusview, welcome/goodbye, anticall),
         config.js (aliases + CHANNEL_INVITES), commands/general.js (new menu), commands/ai.js (OpenAI),
         lib/loadCommands.js (category from file name)

Config Vars (optional): OPENAI_API_KEY, CHANNEL_INVITES (comma separated, first = main channel)
Menu image: put assets/menu-image.jpeg (optional assets/menu-voice.ogg)
