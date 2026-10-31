import js from '@eslint/js';import globals from 'globals';
export default [
 {ignores:['node_modules/**','.venv/**','.qa-venv/**','.local-postgres/**','tmp/**','output/**','backups/**','dist/**','models/**','reviews/**','.runtime/**']},
 js.configs.recommended,
 {files:['**/*.mjs','**/*.js','**/*.cjs'],languageOptions:{ecmaVersion:'latest',globals:{...globals.node,...globals.browser}},rules:{'no-unused-vars':'off','no-control-regex':'off','no-empty':['error',{allowEmptyCatch:true}]}},
 {files:['**/*.cjs'],languageOptions:{sourceType:'commonjs'}}
];
