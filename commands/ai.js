const axios = require('axios');
const config = require('../config');

module.exports = [
  {
    name: 'ai',
    aliases: [
      'gpt', 'ask', 'chat', 'gpt5', 'chatgpt', 'gemini', 'bard', 'deepseek', 'copilot',
      'claudeai', 'metai', 'perplexity', 'felo', 'brainai', 'codeai', 'professor',
      'comedy', 'studyai', 'dj', 'ahmad',
    ],
    description: 'AI se sawaal poochein',
    category: 'ai',
    async execute(ctx) {
      if (!ctx.text) return ctx.reply(`Sawaal likhein. e.g. ${ctx.prefix}ai Pakistan ka capital kya hai?`);
      if (!config.openaiApiKey) return ctx.reply('❌ OPENAI_API_KEY Heroku Config Vars mein set karein.');
      await ctx.react('🤔');
      try {
        const { data } = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          { model: 'gpt-4o-mini', messages: [{ role: 'user', content: ctx.text }] },
          { headers: { Authorization: `Bearer ${config.openaiApiKey}` }, timeout: 30000 }
        );
        await ctx.reply(data.choices[0].message.content);
      } catch (err) {
        console.error(err.response?.data || err.message);
        await ctx.reply('❌ AI se jawab nahi mil saka.');
      }
    },
  },
];
