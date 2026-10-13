import {createServer} from 'node:http';
import handler from './handler.ts';
const port=Number(process.env.PORT??3000);
createServer(handler).listen(port,'127.0.0.1',()=>console.log(`FEM local: http://localhost:${port}`));
