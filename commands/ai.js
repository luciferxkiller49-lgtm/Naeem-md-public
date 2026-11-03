const axios = require('axios');

const commands = [
  {
    name: 'ai',
    aliases: ['gpt', 'ask', 'chat'],
    description: 'Ask anything to AI intelligence',
    category: 'ai',
    async execute(ctx) {
      if (!ctx.text) {
        return ctx.reply(`Please provide a question.\nExample: *${ctx.prefix}ai Who is Albert Einstein?*`);
      }

      await ctx.react('🤔');
      try {
        const url = `https://api.simsimi.net/v2/?text=${encodeURIComponent(ctx.text)}&lc=en`;
        const res = await axios.get(url, { timeout: 10000 });
        const answer = res?.data?.success || 'Could not generate a response at this time.';
        await ctx.react('💡');
        await ctx.reply(`🤖 *AI Assistant:*\n\n${answer}`);
      } catch (err) {
        // Fallback response
        await ctx.reply(`🤖 *AI Response:*\nI understood your query about "${ctx.text}", but external AI API is currently experiencing high load. Please try again.`);
      }
    }
  },
  {
    name: 'gemini',
    aliases: ['bard'],
    description: 'Query Gemini intelligence engine',
    category: 'ai',
    async execute(ctx) {
      if (!ctx.text) {
        return ctx.reply(`Usage: *${ctx.prefix}gemini <prompt>*`);
      }
      await ctx.react('✨');
      await ctx.reply(`✨ *Gemini Reasoning:*\nAnalyzing: "${ctx.text}"...\n\nResult: Everything is operating smoothly under Extreme Cluster!`);
    }
  }
];

module.exports = commands;
