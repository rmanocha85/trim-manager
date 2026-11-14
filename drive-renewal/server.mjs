import {createServer} from 'node:http';
import {Firestore} from '@google-cloud/firestore';
import {handler} from './service.mjs';

const db = new Firestore({databaseId:'trim-drive-renewal'});
const sessions = db.collection('sessions');
const store = {
  create:(id, data)=>sessions.doc(id).create(data),
  async get(id) {
    const data = (await sessions.doc(id).get()).data();
    return data && {...data, expiresAt:data.expiresAt.toDate()};
  },
  remove:id=>sessions.doc(id).delete(),
  rotate(id, previous, next) {
    const doc = sessions.doc(id);
    return db.runTransaction(async tx=>{
      const record = await tx.get(doc);
      if (record.get('refreshToken') === previous) tx.update(doc,{refreshToken:next});
    });
  }
};
createServer(handler({store, clientSecret:process.env.GOOGLE_CLIENT_SECRET, ownerEmail:process.env.TRIM_OWNER_EMAIL}))
  .listen(Number(process.env.PORT || 8080), '0.0.0.0');
