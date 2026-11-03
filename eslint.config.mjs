import js from '@eslint/js';import globals from 'globals';
export default [
 {ignores:['node_modules/**','.venv/**','.qa-venv/**','.local-postgres/**','tmp/**','output/**','backups/**','dist/**','frontend/dist/**','models/**','reviews/**','.runtime/**']},
 js.configs.recommended,
 {files:['**/*.mjs','**/*.js','**/*.cjs'],languageOptions:{ecmaVersion:'latest',globals:{...globals.node,...globals.browser}},rules:{'no-unused-vars':'off','no-control-regex':'off','no-empty':['error',{allowEmptyCatch:true}]}},
 {files:['frontend/src/**/*.jsx'],languageOptions:{ecmaVersion:'latest',sourceType:'module',parserOptions:{ecmaFeatures:{jsx:true}},globals:{...globals.browser}},rules:{'no-unused-vars':'off'}},
 {files:['**/*.cjs'],languageOptions:{sourceType:'commonjs'}}
];
