import {cp,mkdir} from 'node:fs/promises';
await mkdir('public/__theme',{recursive:true});
await cp('theme-dev/assets','public/__theme',{recursive:true});
console.log('Vercel: recursos estáticos preparados en public/__theme.');
