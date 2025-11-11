import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, query, where, onSnapshot, getDocs, Timestamp, orderBy, limit } from 'firebase/firestore';
import { Camera, Clipboard, User, Video, DollarSign, LogOut, Loader2, Zap } from 'lucide-react';

// --- Global Variables Check (Mandatory for Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The main App component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState(null); // 'customer' | 'actor'
  const [isLoading, setIsLoading] = useState(true);
  const [mediaStream, setMediaStream] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentSession, setCurrentSession] = useState(null); // The session being recorded/paid for
  const [customerLibrary, setCustomerLibrary] = useState([]);
  const [actorPortfolio, setActorPortfolio] = useState([]);
  const [error, setError] = useState(null);

  const videoRef = useRef(null);

  // Helper for exponential backoff during API calls (Simulated)
  const exponentialBackoffFetch = useCallback(async (action) => {
    let lastError = null;
    for (let i = 0; i < 3; i++) {
      try {
        const result = await action();
        return result;
      } catch (e) {
        lastError = e;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
    setError(`Operation failed after multiple retries: ${lastError.message}`);
    return null;
  }, []);

  // --- 1. Firebase Initialization and Authentication ---
  useEffect(() => {
    if (Object.keys(firebaseConfig).length === 0) {
      setError("Firebase configuration is missing. Cannot initialize database.");
      setIsLoading(false);
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const newAuth = getAuth(app);
      const newDb = getFirestore(app);

      setAuth(newAuth);
      setDb(newDb);

      // Sign in or listen for auth state
      const authenticate = async () => {
        if (initialAuthToken) {
          await signInWithCustomToken(newAuth, initialAuthToken);
        } else {
          await signInAnonymously(newAuth);
        }
      };

      const unsubscribe = onAuthStateChanged(newAuth, (user) => {
        if (user) {
          setUserId(user.uid);
          // Set a default role if none is selected yet
          if (!userRole) {
             // Delay setting isLoading until after initial choice is made or data is fetched
          }
        } else {
          setUserId(null);
          setUserRole(null);
          setIsLoading(false);
        }
      });

      authenticate().catch(e => {
        setError(`Authentication Failed: ${e.message}`);
        setIsLoading(false);
      });

      return () => unsubscribe();
    } catch (e) {
      setError(`Firebase Init Error: ${e.message}`);
      setIsLoading(false);
    }
  }, []);

  // --- 2. Firestore Data Subscription ---
  useEffect(() => {
    if (!db || !userId || !userRole || isLoading) return;

    const collectionPath = `artifacts/${appId}/public/data/media_sessions`;
    const q = collection(db, collectionPath);

    const subscriptions = [];

    // Customer Library (Media they created/purchased)
    if (userRole === 'customer') {
      // FIX: Removed orderBy('dateCreated', 'desc') to avoid composite index requirement
      const customerQuery = query(q, where('customerId', '==', userId), limit(20));
      const unsubCustomer = onSnapshot(customerQuery, (snapshot) => {
        let sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort client-side instead
        sessions.sort((a, b) => b.dateCreated.toDate() - a.dateCreated.toDate());
        setCustomerLibrary(sessions);
      }, (e) => {
        // The console error is now intentional, as we need to log potential errors other than the index one.
        console.error("Customer Library fetch failed:", e);
      });
      subscriptions.push(unsubCustomer);
    }

    // Actor Portfolio (Media they acted in)
    if (userRole === 'actor') {
      // FIX: Removed orderBy('dateCreated', 'desc') to avoid composite index requirement
      const actorQuery = query(q, where('actorId', '==', userId), limit(20));
      const unsubActor = onSnapshot(actorQuery, (snapshot) => {
        let sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort client-side instead
        sessions.sort((a, b) => b.dateCreated.toDate() - a.dateCreated.toDate());
        setActorPortfolio(sessions);
      }, (e) => {
        // The console error is now intentional, as we need to log potential errors other than the index one.
        console.error("Actor Portfolio fetch failed:", e);
      });
      subscriptions.push(unsubActor);
    }

    // We can stop showing the main loader once the role is set and subscriptions are active
    setIsLoading(false);

    return () => subscriptions.forEach(unsub => unsub());
  }, [db, userId, userRole, isLoading]);


  // --- 3. Camera and Recording Logic ---

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setMediaStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (e) {
      console.error("Camera access denied or failed:", e);
      setError("Camera access is required. Please check permissions.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
  }, [mediaStream]);

  const startNewSession = () => {
    // For simplicity, let's hardcode the "actor" ID to a placeholder for now,
    // as multi-actor selection is outside the scope of the initial single-file app.
    // In a real app, this ID would come from a selected actor profile.
    const placeholderActorId = "ACTOR_DEMO_456";

    // Set up a new session object in state
    setCurrentSession({
        id: crypto.randomUUID(),
        customerId: userId,
        actorId: placeholderActorId,
        title: `Session ${new Date().toLocaleDateString()}`,
        mediaType: 'Video', // Default to video
        isPaid: false,
        isComplete: false,
    });
    // Start camera feed immediately for preparation
    startCamera();
  };

  const startRecording = () => {
    if (!currentSession || !currentSession.isPaid || !mediaStream) return;
    setIsRecording(true);
    // In a real app, MediaRecorder.start() would be called here.
    // We are simulating the recording state.
  };

  const stopRecording = async () => {
    if (!isRecording) return;

    setIsRecording(false);
    stopCamera();

    const sessionData = {
        ...currentSession,
        isComplete: true,
        dateCreated: Timestamp.now(),
        // Placeholder for the media file that would have been uploaded.
        storageUrl: `/media/placeholder/${currentSession.id}.mov`,
        duration: "0:35" // Simulated duration
    };

    // Save the completed session metadata to Firestore
    try {
        const collectionPath = `artifacts/${appId}/public/data/media_sessions`;
        await setDoc(doc(db, collectionPath, currentSession.id), sessionData);
        alertUser("Success!", "Recording session metadata saved to the database. The actor will see it in their portfolio.");
    } catch (e) {
        setError(`Failed to save session data: ${e.message}`);
    } finally {
        setCurrentSession(null);
    }
  };

  // --- 4. Simulated Payment ---
  const simulatePayment = () => {
    if (currentSession) {
        // In a real app, this would involve a transaction API call.
        // On success, we update the session state.
        setCurrentSession(prev => ({ ...prev, isPaid: true }));
        alertUser("Payment Success!", "The actor has been paid. You may now begin filming.");
    }
  };

  // --- 5. UI Helpers ---

  const alertUser = (title, message) => {
    // Custom non-blocking alert using a simple state for demonstration
    alert(`${title}\n\n${message}`);
  };

  const handleLogout = () => {
    stopCamera();
    setUserRole(null);
    setCurrentSession(null);
    setActorPortfolio([]);
    setCustomerLibrary([]);
    setMediaStream(null);
    // Note: We don't sign out of Firebase to maintain the anonymous session, 
    // but we reset the application state to return to the role selection screen.
  }

  // --- Main UI Rendering ---

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <Loader2 className="w-8 h-8 mr-2 animate-spin text-indigo-600" />
        <p className="text-lg text-gray-700">Connecting to the Studio...</p>
      </div>
    );
  }

  if (error) {
    return (
        <div className="p-8 text-center bg-red-100 border border-red-400 rounded-xl m-4">
            <h2 className="font-bold text-xl text-red-700 mb-2">Application Error</h2>
            <p className="text-red-600">{error}</p>
        </div>
    );
  }

  if (!userId || !userRole) {
    // Role Selection Screen
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white p-8 shadow-2xl rounded-2xl text-center">
          <Zap className="w-12 h-12 text-indigo-600 mx-auto mb-4" />
          <h1 className="text-3xl font-extrabold text-gray-900 mb-6">Welcome to Production App</h1>
          <p className="text-gray-600 mb-8">Please select your role to proceed with the application.</p>
          <div className="space-y-4">
            <button
              onClick={() => setUserRole('customer')}
              className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-lg font-medium rounded-xl shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 transition duration-150 ease-in-out transform hover:scale-[1.01]"
            >
              <User className="w-5 h-5 mr-3" /> I am the Customer (Filming)
            </button>
            <button
              onClick={() => setUserRole('actor')}
              className="w-full flex items-center justify-center px-6 py-3 border border-indigo-600 text-lg font-medium rounded-xl shadow-sm text-indigo-600 bg-white hover:bg-indigo-50 transition duration-150 ease-in-out transform hover:scale-[1.01]"
            >
              <Video className="w-5 h-5 mr-3" /> I am the Actor (Portfolio)
            </button>
          </div>
          <p className="mt-6 text-xs text-gray-400">Your user ID: <span className="font-mono text-gray-600 break-all">{userId || 'N/A'}</span></p>
          <p className="mt-1 text-xs text-gray-400">The Actor's Placeholder ID is: <span className="font-mono text-gray-600 break-all">ACTOR_DEMO_456</span> (Use this ID when selecting 'Actor').</p>
        </div>
      </div>
    );
  }

  // --- Customer Dashboard View ---
  const renderCustomerDashboard = () => (
    <div className="flex flex-col lg:flex-row min-h-screen">
      {/* Media Capture Panel */}
      <div className="lg:w-2/3 p-4 md:p-8 bg-gray-900 flex flex-col">
        <h2 className="text-3xl font-extrabold text-white mb-6">Customer Studio</h2>
        <div className="relative flex-grow bg-black rounded-xl overflow-hidden shadow-2xl">
          {mediaStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted // Muting for initial stream preview
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-white text-center p-4">
              <Camera className="w-12 h-12 text-gray-500 mr-4" />
              <p className="text-xl text-gray-400">Camera Feed Loading...</p>
            </div>
          )}

          {/* Recording Indicator */}
          {isRecording && (
            <div className="absolute top-4 left-4 flex items-center bg-red-600 text-white px-3 py-1 rounded-full text-sm font-semibold animate-pulse">
              <div className="w-2 h-2 bg-white rounded-full mr-2"></div> REC
            </div>
          )}

          {/* Action Overlay */}
          <div className="absolute bottom-0 w-full p-4 md:p-6 bg-gradient-to-t from-black/70 to-transparent flex justify-center items-center space-x-4">
            {!currentSession && (
                <button
                    onClick={startNewSession}
                    className="flex items-center px-6 py-3 text-lg font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-lg hover:shadow-indigo-500/50"
                >
                    <Video className="w-5 h-5 mr-3" /> Start New Shoot
                </button>
            )}

            {currentSession && !currentSession.isPaid && (
                <button
                    onClick={simulatePayment}
                    className="flex items-center px-6 py-3 text-lg font-bold rounded-xl text-white bg-yellow-500 hover:bg-yellow-600 transition shadow-lg hover:shadow-yellow-500/50"
                >
                    <DollarSign className="w-5 h-5 mr-3" /> 1. Pay Actor (Simulated)
                </button>
            )}

            {currentSession && currentSession.isPaid && !isRecording && (
                <button
                    onClick={startRecording}
                    className="flex items-center px-6 py-3 text-lg font-bold rounded-xl text-white bg-green-500 hover:bg-green-600 transition shadow-lg hover:shadow-green-500/50"
                    disabled={!mediaStream}
                >
                    <Camera className="w-5 h-5 mr-3" /> 2. Start Recording
                </button>
            )}

            {isRecording && (
                <button
                    onClick={stopRecording}
                    className="flex items-center px-6 py-3 text-lg font-bold rounded-xl text-white bg-red-600 hover:bg-red-700 transition shadow-lg hover:shadow-red-500/50"
                >
                    <Camera className="w-5 h-5 mr-3" /> 3. Stop & Finalize
                </button>
            )}

          </div>
        </div>
      </div>

      {/* Library Panel */}
      <div className="lg:w-1/3 p-4 md:p-8 bg-white overflow-y-auto border-t lg:border-t-0 lg:border-l border-gray-200">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold text-gray-800 flex items-center">
            <Clipboard className="w-6 h-6 mr-2 text-indigo-500" /> My Customer Library
          </h3>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-red-500 transition flex items-center">
            <LogOut className="w-4 h-4 mr-1" /> Switch Role
          </button>
        </div>

        {customerLibrary.length === 0 ? (
          <div className="text-center p-8 bg-gray-50 rounded-xl text-gray-500">
            <p>You haven't completed any sessions yet. Start a new shoot above!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {customerLibrary.map(session => (
              <div key={session.id} className="p-4 border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition bg-white">
                <p className="font-semibold text-indigo-600 truncate">{session.title}</p>
                <p className="text-sm text-gray-500">
                  Type: {session.mediaType} | Date: {session.dateCreated.toDate().toLocaleDateString()}
                </p>
                <p className="text-xs text-gray-400 mt-2 break-all">
                    ID: {session.id}
                </p>
                <button className="mt-2 w-full text-center text-sm text-indigo-500 border border-indigo-200 rounded-lg py-1 hover:bg-indigo-50 transition">
                    View (Simulated Media)
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // --- Actor Portfolio View ---
  const renderActorPortfolio = () => (
    <div className="min-h-screen p-4 md:p-8 bg-gray-50">
      <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-2xl shadow-lg">
        <h1 className="text-3xl font-extrabold text-gray-900 flex items-center">
          <User className="w-8 h-8 mr-3 text-indigo-600" /> My Actor Portfolio
        </h1>
        <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-red-500 transition flex items-center">
          <LogOut className="w-4 h-4 mr-1" /> Switch Role
        </button>
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-xl">
        <h3 className="text-xl font-bold text-gray-800 border-b pb-3 mb-4 flex items-center">
            <Video className="w-5 h-5 mr-2 text-green-500" /> Paid Performance History (View Only)
        </h3>

        {actorPortfolio.length === 0 ? (
          <div className="text-center p-12 bg-gray-100 rounded-xl text-gray-500">
            <p className="text-lg">No completed, paid sessions found for this Actor ID.</p>
            <p className='mt-2 text-sm'>If you are using the placeholder ID **ACTOR_DEMO_456**, try switching to the Customer role and completing a shoot first!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {actorPortfolio.map(session => (
              <div key={session.id} className="p-5 border border-gray-200 rounded-xl shadow-md bg-white hover:bg-gray-50 transition">
                <p className="font-bold text-lg text-gray-900 truncate">{session.title}</p>
                <p className="text-sm text-gray-600 mt-1 flex items-center">
                    <DollarSign className="w-4 h-4 mr-1 text-green-500" /> Status: Paid & Completed
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Customer ID: <span className="font-mono break-all">{session.customerId}</span>
                </p>
                <p className="text-xs text-gray-500">
                  Date: {session.dateCreated.toDate().toLocaleDateString()}
                </p>
                <button
                    disabled
                    className="mt-4 w-full text-center text-sm text-gray-500 border border-gray-300 rounded-lg py-2 bg-gray-100 cursor-not-allowed"
                >
                    View Only (Watermarked Preview)
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // --- Final Render based on Role ---
  if (userRole === 'customer') {
    return renderCustomerDashboard();
  }

  if (userRole === 'actor') {
    return renderActorPortfolio();
  }

  // Should be unreachable if logic is correct
  return null;
};

// Export App as default
export default App;
