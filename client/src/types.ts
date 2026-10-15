export interface Session {protocol:'soil.session.v1';id:string;client:{id:string};subject:string;verified:true;expires_at:number;scopes:string[];capabilities:string[]}
export interface Config {name:string;version:string;release:string;soil:{api_url:string;app_url:string;audience:string};metadata:string;objects:string;max_content_bytes:number;legacy_data_imported:false}
export interface Revision {id:string;resource_id:string;parent:string|null;name:string;digest:string;size:number;deleted:boolean;created_at:number}
export interface Mutation {parent:string|null;name:string;content_base64:string;deleted:boolean}
export interface Receipt {revision:Revision;object_verified:boolean;redundant_backup:boolean;cleanup_allowed:false}
