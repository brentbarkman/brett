const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const monorepoRoot = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// Resolve .js imports to .ts source files (ESM monorepo convention)
config.resolver.sourceExts = [...(config.resolver.sourceExts || []), "mjs", "cjs"];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Rewrite .js imports to try .ts/.tsx first (shared packages use ESM .js extensions)
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const tsName = moduleName.replace(/\.js$/, ".ts");
    try {
      return context.resolveRequest(context, tsName, platform);
    } catch {
      // Fall through to original .js resolution
    }
    const tsxName = moduleName.replace(/\.js$/, ".tsx");
    try {
      return context.resolveRequest(context, tsxName, platform);
    } catch {
      // Fall through
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
