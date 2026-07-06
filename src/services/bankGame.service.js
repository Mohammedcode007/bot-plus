import fs from 'fs/promises';
import path from 'path';
import { clean, normalizeName } from '../utils/text.js';
const BANK_SETTINGS_FILE=path.resolve('data/bank-game.json');
const BANK_STORE_FILE=path.resolve('data/bank-store.json');
function settingsDefault(){return{enabled:true,cooldownSeconds:60,minDepositPoints:10,maxDepositPoints:1000000,profitPercent:10,maturitySeconds:3600};}
function storeDefault(){return{accounts:{}};}
async function ensure(file,data){try{await fs.mkdir(path.dirname(file),{recursive:true});await fs.access(file);}catch{await fs.writeFile(file,JSON.stringify(data,null,2),'utf8');}}
async function readJson(file,data){await ensure(file,data);try{return JSON.parse(await fs.readFile(file,'utf8')||'{}');}catch{return data;}}
async function writeJson(file,data){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data,null,2),'utf8');}
export async function readBankSettings(){const d=await readJson(BANK_SETTINGS_FILE,settingsDefault());return{...settingsDefault(),...d};}
export async function getBankCooldownSeconds(){const s=await readBankSettings();return Number(s.cooldownSeconds)||60;}
export async function readBankStore(){const d=await readJson(BANK_STORE_FILE,storeDefault());d.accounts ||= {};return d;}
export async function writeBankStore(d){d.accounts ||= {};await writeJson(BANK_STORE_FILE,d);}
function key(username){return normalizeName(username);} 
export async function getBankAccount(username){const k=key(username);if(!k)return{username:clean(username),deposits:[]};const s=await readBankStore();const a=s.accounts[k]||{username:clean(username),deposits:[]};a.deposits=Array.isArray(a.deposits)?a.deposits:[];return a;}
export async function createBankDeposit({username,amount}){const set=await readBankSettings();if(set.enabled!==true)return{ok:false,reason:'bank_disabled'};const a=Math.max(0,Math.floor(Number(amount)||0));const min=Math.max(1,Number(set.minDepositPoints)||10);const max=Math.max(min,Number(set.maxDepositPoints)||1000000);if(a<min)return{ok:false,reason:`Minimum deposit is ${min} points.`};if(a>max)return{ok:false,reason:`Maximum deposit is ${max} points.`};const k=key(username);if(!k)return{ok:false,reason:'missing_username'};const now=Date.now();const profitPercent=Number(set.profitPercent)||10;const profit=Math.max(1,Math.floor((a*profitPercent)/100));const dep={id:`bank_${now}_${Math.random().toString(16).slice(2)}`,amount:a,profit,total:a+profit,profitPercent,createdAt:new Date(now).toISOString(),readyAt:new Date(now+(Number(set.maturitySeconds)||3600)*1000).toISOString(),withdrawn:false};const store=await readBankStore();const account=store.accounts[k]||{username:clean(username),deposits:[]};account.username=clean(username);account.deposits=Array.isArray(account.deposits)?account.deposits:[];account.deposits.push(dep);store.accounts[k]=account;await writeBankStore(store);return{ok:true,deposit:dep};}
export async function withdrawReadyBankDeposits(username){const k=key(username);if(!k)return{ok:false,reason:'missing_username',amount:0,deposits:[]};const store=await readBankStore();const a=store.accounts[k];if(!a||!Array.isArray(a.deposits))return{ok:true,amount:0,deposits:[]};const now=Date.now();const ready=a.deposits.filter(d=>d&&d.withdrawn!==true&&Date.parse(d.readyAt)<=now);const amount=ready.reduce((sum,d)=>sum+(Number(d.total)||0),0);for(const d of ready){d.withdrawn=true;d.withdrawnAt=new Date().toISOString();}await writeBankStore(store);return{ok:true,amount,deposits:ready};}
