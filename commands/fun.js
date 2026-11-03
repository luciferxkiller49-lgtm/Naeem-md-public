const commands = [
  {
    name: 'roast',
    aliases: ['insult'],
    description: 'Playful roast for someone in the chat',
    category: 'fun',
    async execute(ctx) {
      const roasts = [
        "You bring everyone so much joy... when you leave the room.",
        "I'd agree with you, but then we'd both be wrong.",
        "Your secrets are always safe with me. I never even listen when you talk.",
        "Light travels faster than sound. That's why you seemed bright until you spoke.",
        "You're not stupid; you just have bad luck when thinking."
      ];
      const random = roasts[Math.floor(Math.random() * roasts.length)];
      await ctx.reply(`🔥 *Roast:* ${random}`);
    }
  },
  {
    name: 'joke',
    aliases: ['funny'],
    description: 'Tell a random funny joke',
    category: 'fun',
    async execute(ctx) {
      const jokes = [
        "Why do programmers prefer dark mode? Because light attracts bugs!",
        "There are 10 types of people in the world: those who understand binary, and those who don't.",
        "Why did the JavaScript developer wear glasses? Because they don't C#!",
        "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'"
      ];
      const random = jokes[Math.floor(Math.random() * jokes.length)];
      await ctx.reply(`😂 *Joke:* ${random}`);
    }
  },
  {
    name: 'quote',
    aliases: ['motivate'],
    description: 'Get an inspirational motivational quote',
    category: 'fun',
    async execute(ctx) {
      const quotes = [
        "The best way to predict the future is to create it.",
        "Success is not final, failure is not fatal: it is the courage to continue that counts.",
        "Believe you can and you're halfway there.",
        "Do what you can, with what you have, where you are."
      ];
      const random = quotes[Math.floor(Math.random() * quotes.length)];
      await ctx.reply(`✨ *Quote:* "${random}"`);
    }
  },
  {
    name: 'roll',
    aliases: ['dice'],
    description: 'Roll a 6-sided die',
    category: 'fun',
    async execute(ctx) {
      const roll = Math.floor(Math.random() * 6) + 1;
      await ctx.reply(`🎲 *You rolled:* ${roll}`);
    }
  },
  {
    name: 'flip',
    aliases: ['coin'],
    description: 'Flip a coin (Heads or Tails)',
    category: 'fun',
    async execute(ctx) {
      const result = Math.random() > 0.5 ? 'Heads' : 'Tails';
      await ctx.reply(`🪙 *Coin flipped:* ${result}`);
    }
  },
  {
    name: 'hack',
    aliases: ['fakehack'],
    description: 'Simulate a funny terminal hack on target',
    category: 'fun',
    async execute(ctx) {
      const target = ctx.args[0] || 'Target Device';
      await ctx.reply(`💻 Initiating cyber-breach on ${target}...`);
      await new Promise(r => setTimeout(r, 1200));
      await ctx.reply(`🔓 Bypassing firewalls [████████░░] 80%...`);
      await new Promise(r => setTimeout(r, 1000));
      await ctx.reply(`🎉 Success! Found 0 files of interest. Mission accomplished.`);
    }
  }
];

module.exports = commands;
