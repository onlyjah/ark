import { createAuthClient } from '@neondatabase/auth';
import * as vault from './vault.js';
import * as sync from '../../src/sync.ts';
import { createSoilClient } from '../../xtp/soil/client.js';
window.ArkIdentity={createAuthClient,sync,...vault};
window.Soil={createClient:createSoilClient};
