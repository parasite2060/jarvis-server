module.exports = {
  files: ["{src,apps,libs,test}/**/*.ts"],
  formats: [
    {
      name: "stylish",
      output: "console"
    },
    {
      name: "json",
      output: "file",
      path: "./report/eslint/eslint.json",
      id: "gitlab"
    }
  ],
  eslintConfig: {}
};