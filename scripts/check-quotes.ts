import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Jah Noah [Q037]: "be sure to quote me on the shit that I be saying."
// Engineering: quote comments must match a catalog entry exactly; paraphrases are never attributed quotations.
const catalog=JSON.parse(readFileSync(new URL('../quotes/catalog.json',import.meta.url),'utf8'));
const quotes=new Map(catalog.quotes.map((q:any)=>[q.id,q.text]));
if(quotes.size!==catalog.quotes.length) throw new Error('duplicate quote ID');
let checked=0;
function walk(dir:string) {
  for(const item of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,item.name);if(item.isDirectory())walk(path);
    else if((path.endsWith('.ts') || path.endsWith('.js'))) {
      const source=readFileSync(path,'utf8');
      for(const match of source.matchAll(/\/\/ Jah Noah \[(Q\d+)\]: ("[^\n]+")/g)) {
        if(quotes.get(match[1])!==JSON.parse(match[2])) throw new Error(`quote mismatch in ${path}: ${match[1]}`);
        checked++;
      }
    }
  }
}
for(const dir of ['src','packages','services','plugins','test','scripts','client','railway','web']) walk(dir);
console.log(`${catalog.quotes.length} catalog quotes; ${checked} code comment references verified.`);
