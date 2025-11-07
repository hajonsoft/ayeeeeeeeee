// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDCrxo80kvwO8kvHjV0jlgDHesZo87oRhc",
  authDomain: "ayeeeeeeeee.firebaseapp.com",
  projectId: "ayeeeeeeeee",
  storageBucket: "ayeeeeeeeee.firebasestorage.app",
  messagingSenderId: "39274424177",
  appId: "1:39274424177:web:b43b1bf60c65835fce38d0",
  measurementId: "G-Y60M79BB9K"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { db, analytics };
export default app;