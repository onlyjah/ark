import type { Store } from '../../packages/core/store.ts';
// KASH observations are read-only projections. A configured archive is not a verified backup.
export function createKashObserver(store: Store) {
  let sequence = Date.now();
  return (actor: {id:string}, archiveConfigured:boolean) => {
    sequence = Math.max(sequence + 1, Date.now());
    const documentCount=store.one('SELECT COUNT(*) AS n FROM web_documents WHERE owner_id=?',actor.id).n;
    const projectCount=store.one('SELECT COUNT(*) AS n FROM web_projects WHERE owner_id=?',actor.id).n;
    const used=store.one('SELECT COALESCE(SUM(size),0) AS n FROM web_objects WHERE owner_id=?',actor.id).n;
    const revisions=store.one('SELECT COUNT(*) AS n FROM web_revisions v JOIN web_documents d ON d.id=v.document_id WHERE d.owner_id=?',actor.id).n;
    return { schema_version:'0.1.0', context_id:'kash:workspace:'+actor.id, sequence,
      observed_at:new Date().toISOString(),connection:'online',source:'live',
      places:[
        {id:'archive-a',label:'Archive',kind:'archive',site:archiveConfigured?'Connection configured':'Not configured',online:false,availability:archiveConfigured?'unknown':'unconfigured',has_copy:false,x:.22,y:.22},
        {id:'archive-b',label:'Backup',kind:'archive',site:'Not configured',online:false,availability:'unconfigured',has_copy:false,x:.75,y:.22},
        {id:'backup-b',label:'Offsite',kind:'archive',site:'Not configured',online:false,availability:'unconfigured',has_copy:false,x:.79,y:.46},
        {id:'index',label:'Index',kind:'index',site:'Authorized workspace',online:true,availability:'online',has_copy:false,x:.49,y:.45},
        {id:'working',label:'Working',kind:'working',site:'Current browser',online:true,availability:'online',has_copy:false,x:.25,y:.70},
        {id:'thin',label:'Thin',kind:'thin',site:'Current browser',online:true,availability:'online',has_copy:false,x:.69,y:.80}
      ],edges:[{from:'working',to:'index'},{from:'thin',to:'index'},{from:'index',to:'archive-a'}],
      resource:{id:'workspace:'+actor.id,label:'Workspace',revision:'workspace-observation',protected_revision:'unverified',phase:'pending',
        required_copies:3,required_sites:2,policy_epoch:0,protection_valid_until:new Date().toISOString(),local_copies:[],allowed_actions:[]},
      observation:{documents:documentCount,projects:projectCount,revisions,used_bytes:used,quota_bytes:5_000_000_000,
        archive_configured:archiveConfigured,archive_health:'unverified',backup_state:'unconfigured',
        automatic_cleanup:false,profile_targets_status:'proposal',device_agents:'unpaired'}
    };
  };
}
