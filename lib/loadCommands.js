const fs = require('fs');
const path = require('path');

class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  load() {
    this.commands.clear();
    this.aliases.clear();

    const commandsDir = path.join(__dirname, '..', 'commands');
    if (!fs.existsSync(commandsDir)) {
      console.warn('[LOADER] Commands directory does not exist:', commandsDir);
      return;
    }

    // Prioritized order: base commands first, queen-extra last
    const filePriority = [
      'fleet.js',
      'status-panel.js',
      'group-features.js',
      'gcstatus.js',
      'general.js',
      'group-admin.js',
      'ai.js',
      'downloader.js',
      'group.js',
      'moderation.js',
      'media.js',
      'fun.js',
      'islamic.js',
      'settings.js',
      'utility.js',
      'queen-extra.js'
    ];

    const actualFiles = fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'));
    const sortedFiles = actualFiles.sort((a, b) => {
      let idxA = filePriority.indexOf(a);
      let idxB = filePriority.indexOf(b);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      return idxA - idxB;
    });

    for (const file of sortedFiles) {
      try {
        const filePath = path.join(commandsDir, file);
        delete require.cache[require.resolve(filePath)];
        const exported = require(filePath);

        // Can export either a single command object or an array of command objects
        const list = Array.isArray(exported) ? exported : (exported.commands || [exported]);

        for (const cmd of list) {
          if (!cmd || !cmd.name || typeof cmd.execute !== 'function') continue;

          if (!cmd.category) cmd.category = file.replace(/^kb-/, '').replace(/\.js$/, '');
          const name = cmd.name.toLowerCase();

          if (this.commands.has(name)) {
            console.warn(`[LOADER] Collision: Command '${name}' from ${file} already registered. Skipping duplicate.`);
            continue;
          }

          this.commands.set(name, cmd);

          if (Array.isArray(cmd.aliases)) {
            for (const alias of cmd.aliases) {
              const a = alias.toLowerCase();
              if (this.aliases.has(a) || this.commands.has(a)) {
                console.warn(`[LOADER] Alias collision: '${a}' in ${file} already taken. Skipping alias.`);
              } else {
                this.aliases.set(a, name);
              }
            }
          }
        }
      } catch (err) {
        console.error(`[LOADER] Failed to load ${file}:`, err.message);
      }
    }

    console.log(`[LOADER] Successfully loaded ${this.commands.size} commands and ${this.aliases.size} aliases.`);
  }

  find(trigger) {
    if (!trigger) return null;
    const clean = trigger.toLowerCase();
    if (this.commands.has(clean)) {
      return this.commands.get(clean);
    }
    const realName = this.aliases.get(clean);
    if (realName && this.commands.has(realName)) {
      return this.commands.get(realName);
    }
    return null;
  }

  getAll() {
    return Array.from(this.commands.values());
  }
}

const registry = new CommandRegistry();
module.exports = registry;
