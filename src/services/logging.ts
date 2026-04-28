import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface ActivityLog {
  action: string;
  details?: any;
  status: 'success' | 'failed' | 'pending';
}

/**
 * Logs user activity to Firestore for monitoring.
 */
export async function logActivity(activity: ActivityLog) {
  try {
    const user = auth.currentUser;
    const logData = {
      ...activity,
      userId: user ? user.uid : 'anonymous',
      timestamp: serverTimestamp(),
      userAgent: navigator.userAgent,
    };

    await addDoc(collection(db, 'logs'), logData);
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}
