import {defineConfig} from 'vite';
export default defineConfig({root:'frontend',publicDir:false,build:{outDir:'dist',emptyOutDir:true},server:{proxy:{'/api':'http://127.0.0.1:4317'}}});
