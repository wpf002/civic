/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@civic/core"],
  // @civic/core is TypeScript source using ESM ".js" specifiers, which is correct for
  // Node's resolver but not something webpack maps to ".ts" on its own.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"],
  },
};
