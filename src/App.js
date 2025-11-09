import React, { useState, useEffect, useCallback } from 'react';
import { collection, addDoc, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { deleteDoc, doc } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { db, auth } from './firebase';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import './App.css';

function App() {
  const [location, setLocation] = useState({
    latitude: null,
    longitude: null,
    accuracy: null
  });
  const [speed, setSpeed] = useState(0);
  const [direction, setDirection] = useState(0);
  const [previousLocation, setPreviousLocation] = useState(null);
  const [speedBumps, setSpeedBumps] = useState([]);
  const [nearbySpeedBumps, setNearbySpeedBumps] = useState([]);
  const [isTracking, setIsTracking] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());
  const [lastQueryLocation, setLastQueryLocation] = useState(null);
  const [isLoadingSpeedBumps, setIsLoadingSpeedBumps] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastQueryTime, setLastQueryTime] = useState(0);
  const [activeQueryUnsubscribe, setActiveQueryUnsubscribe] = useState(null);
  const [user, setUser] = useState(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [username, setUsername] = useState('');
  const [isUserInfoVisible, setIsUserInfoVisible] = useState(false);
  const [isRecordingSpeedBump, setIsRecordingSpeedBump] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDangerMode, setIsDangerMode] = useState(false);
  const [speedBumpsAhead, setSpeedBumpsAhead] = useState([]);

  const NEARBY_DISTANCE = 500; // meters - for display
  const QUERY_RADIUS = 100; // kilometers - for database query
  const QUERY_UPDATE_THRESHOLD = 10; // kilometers - when to refresh query
  const QUERY_COOLDOWN = 30000; // 30 seconds minimum between queries
  const LOCATION_DEBOUNCE = 5000; // 5 seconds debounce for location updates

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = useCallback((lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in meters
  }, []);

  // Calculate bearing (direction) between two coordinates
  const calculateBearing = useCallback((lat1, lon1, lat2, lon2) => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360; // Normalize to 0-360 degrees
  }, []);

  // Enhanced direction calculation - determines if speed bump is ahead or behind based on movement
  const isSpeedBumpAhead = useCallback((currentLat, currentLng, bumpLat, bumpLng, movementDirection) => {
    if (!movementDirection && movementDirection !== 0) return true; // Default to ahead if no direction
    
    // Calculate bearing from current position to speed bump
    const bearingToBump = calculateBearing(currentLat, currentLng, bumpLat, bumpLng);
    
    // Calculate the difference between movement direction and bearing to bump
    let angleDiff = Math.abs(bearingToBump - movementDirection);
    if (angleDiff > 180) {
      angleDiff = 360 - angleDiff;
    }
    
    // If angle difference is less than 90 degrees, speed bump is ahead
    // If more than 90 degrees, it's behind
    return angleDiff < 90;
  }, [calculateBearing]);

  // Get compass direction from bearing
  const getCompassDirection = useCallback((bearing) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }, []);

  // Authentication effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Set username based on Google account or anonymous user
        if (currentUser.displayName) {
          setUsername(currentUser.displayName);
        } else if (currentUser.email) {
          setUsername(currentUser.email.split('@')[0]);
        } else {
          setUsername(`Driver_${currentUser.uid.slice(-8)}`);
        }
        setIsAuthenticating(false);
      } else {
        setUser(null);
        setUsername('');
        setIsAuthenticating(false);
      }
    });

    return unsubscribe;
  }, []);

  // Initialize audio and notification permissions
  useEffect(() => {
    const initializePermissions = async () => {
      // Request notification permission for audio fallback
      if ('Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
          console.log('📣 Notification permission requested');
        } catch (error) {
          console.log('Notification permission not available:', error);
        }
      }

      // Initialize audio context on first user interaction
      const initAudio = () => {
        try {
          if (window.AudioContext || window.webkitAudioContext) {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') {
              audioContext.resume();
            }
            console.log('🔊 Audio context initialized');
            document.removeEventListener('click', initAudio);
            document.removeEventListener('touchstart', initAudio);
          }
        } catch (error) {
          console.log('Audio context initialization failed:', error);
        }
      };

      // Listen for first user interaction to initialize audio
      document.addEventListener('click', initAudio);
      document.addEventListener('touchstart', initAudio);
    };

    initializePermissions();
  }, []);

  // Google Sign In
  const signInWithGoogle = useCallback(async () => {
    try {
      setIsAuthenticating(true);
      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      
      const result = await signInWithPopup(auth, provider);
      console.log('Google sign-in successful:', result.user.displayName);
    } catch (error) {
      console.error('Google sign-in error:', error);
      setIsAuthenticating(false);
      if (error.code !== 'auth/popup-closed-by-user') {
        alert('Failed to sign in with Google. Please try again.');
      }
    }
  }, []);

  // Sign Out
  const handleSignOut = useCallback(async () => {
    try {
      await signOut(auth);
      console.log('User signed out');
    } catch (error) {
      console.error('Sign out error:', error);
      alert('Failed to sign out. Please try again.');
    }
  }, []);

  // Handle new position data with improved speed calculation
  const handlePositionUpdate = useCallback((position) => {
    const { latitude, longitude, accuracy, speed: gpsSpeed } = position.coords;
    const currentTime = Date.now();
    
    setLocation({ latitude, longitude, accuracy });

    // Use GPS speed if available, otherwise calculate from distance
    let calculatedSpeed = 0;
    
    if (gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed >= 0) {
      calculatedSpeed = gpsSpeed * 3.6; // Convert m/s to km/h
    } else if (previousLocation && currentTime - lastUpdateTime > 500) { // Update every 500ms minimum
      const distance = calculateDistance(
        previousLocation.latitude,
        previousLocation.longitude,
        latitude,
        longitude
      );
      
      const timeInterval = currentTime - lastUpdateTime;
      
      // Only calculate if moved significantly
      if (distance > 0.5 && timeInterval > 500) { // Moved at least 0.5m
        const speedMPS = distance / (timeInterval / 1000);
        calculatedSpeed = Math.max(0, speedMPS * 3.6); // Convert to km/h, ensure non-negative
      } else {
        calculatedSpeed = speed; // Keep previous speed if no significant movement
      }
    }

    // Smooth speed calculation to reduce noise
    setSpeed(prevSpeed => {
      const smoothedSpeed = prevSpeed * 0.7 + calculatedSpeed * 0.3;
      return Math.max(0, smoothedSpeed);
    });

    if (previousLocation && currentTime - lastUpdateTime > 500) {
      const newDirection = calculateBearing(
        previousLocation.latitude,
        previousLocation.longitude,
        latitude,
        longitude
      );
      
      if (!isNaN(newDirection)) {
        setDirection(newDirection);
      }
      
      setLastUpdateTime(currentTime);
    }
    
    setPreviousLocation({ latitude, longitude, timestamp: currentTime });
  }, [previousLocation, lastUpdateTime, speed, calculateDistance, calculateBearing]);

  // Start GPS tracking with higher frequency
  const startTracking = useCallback(() => {
    if (navigator.geolocation) {
      setIsTracking(true);
      const watchId = navigator.geolocation.watchPosition(
        handlePositionUpdate,
        (error) => {
          console.error('GPS Error:', error);
          setIsTracking(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0 // Always get fresh position
        }
      );
      
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      alert('Geolocation is not supported by this browser.');
      return () => {}; // Return empty function if geolocation not supported
    }
  }, [handlePositionUpdate]);

  // Calculate geographic bounding box for efficient querying
  const getGeographicBounds = useCallback((centerLat, centerLng, radiusKm) => {
    // Convert radius from km to degrees (approximate)
    // 1 degree of latitude ≈ 111 km
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));
    
    return {
      north: centerLat + latDelta,
      south: centerLat - latDelta,
      east: centerLng + lngDelta,
      west: centerLng - lngDelta
    };
  }, []);

  // Load nearby speed bumps using bounding box query
  const loadNearbySpeedBumps = useCallback(async (lat, lng, radius = QUERY_RADIUS) => {
    if (!lat || !lng) return;
    
    // Prevent multiple concurrent queries
    if (isLoadingSpeedBumps) {
      console.log('Query already in progress, skipping...');
      return;
    }
    
    // Clean up existing subscription
    if (activeQueryUnsubscribe && typeof activeQueryUnsubscribe === 'function') {
      console.log('Cleaning up previous subscription...');
      activeQueryUnsubscribe();
      setActiveQueryUnsubscribe(null);
    }
    
    setIsLoadingSpeedBumps(true);
    setLastQueryTime(Date.now());
    
    try {
      // Calculate bounding box
      const bounds = getGeographicBounds(lat, lng, radius);
      
      console.log(`🔍 Querying speed bumps within ${radius}km of ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      console.log('📦 Calculated bounds:', bounds);
      
      // Use a simpler query to avoid Firestore compound query limitations
      // Query only by latitude range, then filter longitude and distance on client
      const q = query(
        collection(db, 'speedBumps'),
        where('latitude', '>=', bounds.south),
        where('latitude', '<=', bounds.north)
      );

      console.log('🔍 Firestore query created for latitude range:', bounds.south, 'to', bounds.north);

      // Listen for real-time updates
      const unsubscribe = onSnapshot(q, (snapshot) => {
        console.log(`📄 Firestore returned ${snapshot.size} documents within latitude bounds`);
        const bumps = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          console.log(`📍 Processing document ${doc.id}:`, {
            id: doc.id,
            lat: data.latitude, 
            lng: data.longitude,
            inLatBounds: data.latitude >= bounds.south && data.latitude <= bounds.north,
            inLngBounds: data.longitude >= bounds.west && data.longitude <= bounds.east
          });
          
          // Filter by longitude range and circular distance
          if (data.longitude >= bounds.west && 
              data.longitude <= bounds.east) {
            const distance = calculateDistance(lat, lng, data.latitude, data.longitude);
            console.log(`📏 Distance to ${doc.id}: ${distance}m (${(distance/1000).toFixed(1)}km)`);
            
            if (distance <= radius * 1000) { // Convert km to meters
              bumps.push({
                id: doc.id,
                distance: distance,
                ...data
              });
              console.log(`✅ Added speed bump ${doc.id} at ${(distance/1000).toFixed(1)}km`);
            } else {
              console.log(`❌ Excluded speed bump ${doc.id} - too far: ${(distance/1000).toFixed(1)}km`);
            }
          } else {
            console.log(`❌ Excluded speed bump ${doc.id} - outside longitude bounds:`, {
              longitude: data.longitude,
              west: bounds.west,
              east: bounds.east,
              withinBounds: data.longitude >= bounds.west && data.longitude <= bounds.east
            });
          }
        });
        
        // Sort by distance
        bumps.sort((a, b) => a.distance - b.distance);
        
        console.log(`Final result: ${bumps.length} speed bumps within ${radius}km radius:`);
        bumps.forEach((bump, i) => {
          console.log(`  ${i+1}. ${bump.id} - ${(bump.distance/1000).toFixed(1)}km`);
        });
        
        setSpeedBumps(bumps);
        setIsLoadingSpeedBumps(false);
        setLastQueryLocation({ latitude: lat, longitude: lng });
      }, (error) => {
        console.error('Error in speed bumps subscription:', error);
        setIsLoadingSpeedBumps(false);
      });

      setActiveQueryUnsubscribe(() => unsubscribe);
      return unsubscribe;
    } catch (error) {
      console.error('Error loading nearby speed bumps:', error);
      setIsLoadingSpeedBumps(false);
    }
  }, [getGeographicBounds, calculateDistance, QUERY_RADIUS, isLoadingSpeedBumps, activeQueryUnsubscribe]);

  // Record speed bump to Firebase with user information
  const recordSpeedBump = useCallback(async () => {
    if (!location.latitude || !location.longitude) {
      return; // Silently fail if no GPS
    }

    if (!user) {
      return; // Silently fail if no user
    }

    if (isRecordingSpeedBump) {
      return; // Prevent double-clicks
    }

    try {
      setIsRecordingSpeedBump(true);
      
      console.log('Recording speed bump...', {
        latitude: location.latitude,
        longitude: location.longitude,
        user: user.uid,
        username: username
      });

      const speedBump = {
        latitude: location.latitude,
        longitude: location.longitude,
        direction: direction,
        speed: speed,
        compassDirection: getCompassDirection(direction),
        timestamp: new Date(),
        accuracy: location.accuracy || 0,
        // User information
        userId: user.uid,
        username: username,
        // Additional metadata
        createdAt: new Date(),
        deviceInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform
        }
      };
      
      // Add to Firestore with detailed logging
      console.log('Adding document to Firestore...', speedBump);
      const docRef = await addDoc(collection(db, 'speedBumps'), speedBump);
      
      console.log('Speed bump recorded successfully with ID:', docRef.id);
      
      // Refresh nearby speed bumps if auto-refresh is enabled
      if (autoRefresh) {
        await loadNearbySpeedBumps(location.latitude, location.longitude);
      }
    } catch (error) {
      console.error('Detailed error recording speed bump:', {
        error: error,
        code: error.code,
        message: error.message,
        user: user?.uid,
        location: location
      });
    } finally {
      setIsRecordingSpeedBump(false);
    }
  }, [location, direction, speed, getCompassDirection, user, username, autoRefresh, loadNearbySpeedBumps, isRecordingSpeedBump]);

  // Delete speed bump function
  const deleteSpeedBump = useCallback(async (speedBumpId) => {
    if (!user) {
      console.log('User not authenticated, cannot delete speed bump');
      return;
    }

    try {
      console.log('Deleting speed bump:', speedBumpId);
      
      // Delete from Firestore
      await deleteDoc(doc(db, 'speedBumps', speedBumpId));
      
      console.log('Speed bump deleted successfully:', speedBumpId);
      
      // Remove from local state immediately for instant UI feedback
      setSpeedBumps(prevBumps => prevBumps.filter(bump => bump.id !== speedBumpId));
      setNearbySpeedBumps(prevNearby => prevNearby.filter(bump => bump.id !== speedBumpId));
      
    } catch (error) {
      console.error('Error deleting speed bump:', error);
      
      // Reload speed bumps on error to ensure UI consistency
      if (location.latitude && location.longitude) {
        loadNearbySpeedBumps(location.latitude, location.longitude);
      }
    }
  }, [user, location.latitude, location.longitude, loadNearbySpeedBumps]);

  // Vibration alert (for mobile devices)
  const triggerVibration = useCallback(() => {
    if ('vibrate' in navigator) {
      // Strong vibration pattern: long buzz, pause, 3 short buzzes
      navigator.vibrate([500, 200, 100, 100, 100, 100, 100]);
      console.log('📳 VIBRATION TRIGGERED');
    }
  }, []);

  // Fullscreen functionality
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Enhanced urgent audio alert system
  const playWarningSound = useCallback(() => {
    try {
      console.log('🔊 PLAYING URGENT WARNING SOUND');
      
      // Create multiple audio alerts with better browser support
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Resume audio context if suspended (required on many browsers after user interaction)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      
      // Play a sequence of urgent beeps
      const playBeep = (frequency, duration, delay = 0) => {
        setTimeout(() => {
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();
          
          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);
          
          oscillator.frequency.value = frequency;
          oscillator.type = 'sawtooth'; // More harsh/urgent sound than sine
          
          gainNode.gain.setValueAtTime(0.8, audioContext.currentTime); // Much louder volume
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
          
          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + duration);
        }, delay);
      };
      
      // Play urgent sequence: 3 quick high-pitched beeps
      playBeep(1200, 0.15, 0);    // Very high beep
      playBeep(900, 0.15, 200);   // High beep  
      playBeep(1400, 0.2, 400);   // Extremely high beep
      
    } catch (error) {
      console.error('Primary audio failed:', error);
      
      // Fallback 1: Try HTML5 audio with beep sound
      try {
        const audio = new Audio();
        audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmMcBSKB0fTWfCsEKHfM8N6QQgsMW7Pp4qNTFApsqebUhz0KOovN8uF9KQQvgdPz1oAqBSuBzfDcaR0INYvU9OV/KgUqaLjl4pNQEg8xotf04YAqBSdcpt7vo2EQD2Sc1/HdaR0IMYLt89qBKQVTe9H04ehuFghUe6Hv3mEQDWuBz/LfaiALJITT9OJ9KQUpaOTe5oFDBDVQebHv3W4qBiOI2vDdaxwJM3e89N5QEQ8ybOfk5ZdOFAl/ntLz2IAqBCCB0fPaeCwGI3bM8N6QQgkTXLPp4qNTFAlIoutSEQ4ngNPz1oAqBSuBzfDcaR0INYvU9OV/KgUqaLjl4pNQEg8xotf04YAqBSdcpt7vo2EQD2Sc1/HdaR0IMYLt89qBKQVTe9H04ehuFghUe6Hv3mEQDWuBz/LfaiALJITT9OJ9KQUpaOTe5oFDBDVQebHv3W4qBiOI2vDdaxwJM3e89N5QEQ8ybOfk5ZdOFAl/ntLz2IAqBCCB0fPaeCwGI3bM8N6QQgkTXLPp4qNTFA==';
        audio.volume = 0.7;
        audio.play();
        console.log('🔊 Fallback HTML5 audio played');
      } catch (fallbackError) {
        console.error('HTML5 audio fallback failed:', fallbackError);
        
        // Fallback 2: System notification sound
        try {
          new Notification('⚠️ SPEED BUMP AHEAD!', {
            icon: '⚠️',
            tag: 'speedbump-warning'
          });
          console.log('🔔 Notification fallback used');
        } catch (notifError) {
          console.error('All audio methods failed:', notifError);
        }
      }
    }
  }, []);

  // Check if we need to update the query based on location change and cooldown
  const shouldUpdateQuery = useCallback((currentLat, currentLng, lastLat, lastLng) => {
    if (!lastLat || !lastLng) return true;
    
    // Check cooldown period
    const now = Date.now();
    if (now - lastQueryTime < QUERY_COOLDOWN) {
      return false;
    }
    
    const distance = calculateDistance(currentLat, currentLng, lastLat, lastLng);
    return distance > (QUERY_UPDATE_THRESHOLD * 1000); // Convert km to meters
  }, [calculateDistance, QUERY_UPDATE_THRESHOLD, lastQueryTime, QUERY_COOLDOWN]);

  // Test query to debug database contents (temporary)
  const debugDatabaseContents = useCallback(async () => {
    console.log('🔬 DEBUG: Checking all documents in speedBumps collection...');
    try {
      const allDocsQuery = query(collection(db, 'speedBumps'));
      const snapshot = await getDocs(allDocsQuery);
      console.log(`🔬 DEBUG: Found ${snapshot.size} total documents in database`);
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        console.log(`🔬 Document ${doc.id}:`, {
          id: doc.id,
          latitude: data.latitude,
          longitude: data.longitude,
          hasLatitude: data.latitude !== undefined,
          hasLongitude: data.longitude !== undefined,
          latitudeType: typeof data.latitude,
          longitudeType: typeof data.longitude
        });
      });
    } catch (error) {
      console.error('🔬 DEBUG: Error fetching all documents:', error);
    }
  }, []);

  // Auto-load speed bumps when user is authenticated and GPS is available
  useEffect(() => {
    if (user && location.latitude && location.longitude && speedBumps.length === 0) {
      console.log('Initial load: Loading speed bumps for authenticated user...');
      debugDatabaseContents(); // Debug database contents
      loadNearbySpeedBumps(location.latitude, location.longitude);
    }
  }, [user, location.latitude, location.longitude, speedBumps.length, loadNearbySpeedBumps, debugDatabaseContents]);

  // Debounced location effect to prevent excessive queries
  useEffect(() => {
    let timeoutId;
    
    if (location.latitude && location.longitude && autoRefresh) {
      // Debounce location updates
      timeoutId = setTimeout(() => {
        if (shouldUpdateQuery(
          location.latitude, 
          location.longitude, 
          lastQueryLocation?.latitude, 
          lastQueryLocation?.longitude
        )) {
          console.log('Location changed significantly, updating speed bumps query...');
          const loadData = async () => {
            const unsubscribe = await loadNearbySpeedBumps(location.latitude, location.longitude);
            if (unsubscribe) {
              setLastQueryLocation({ 
                latitude: location.latitude, 
                longitude: location.longitude 
              });
            }
          };
          
          loadData();
        }
      }, LOCATION_DEBOUNCE);
    }
    
    // Cleanup timeout
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [location.latitude, location.longitude, lastQueryLocation, shouldUpdateQuery, loadNearbySpeedBumps, autoRefresh, LOCATION_DEBOUNCE]);

  // Initial load when GPS first locks
  useEffect(() => {
    if (location.latitude && location.longitude && !lastQueryLocation && !isLoadingSpeedBumps) {
      console.log('Initial GPS lock, loading speed bumps...');
      const loadInitialData = async () => {
        await loadNearbySpeedBumps(location.latitude, location.longitude);
        setLastQueryLocation({ 
          latitude: location.latitude, 
          longitude: location.longitude 
        });
      };
      
      loadInitialData();
    }
  }, [location.latitude, location.longitude, lastQueryLocation, isLoadingSpeedBumps, loadNearbySpeedBumps]);

  // Cleanup active subscription on component unmount
  useEffect(() => {
    return () => {
      if (activeQueryUnsubscribe && typeof activeQueryUnsubscribe === 'function') {
        console.log('Component unmounting, cleaning up speed bumps subscription');
        activeQueryUnsubscribe();
      }
    };
  }, [activeQueryUnsubscribe]);

  // Initialize tracking on component mount
  useEffect(() => {
    const cleanup = startTracking();
    return () => {
      if (cleanup && typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [startTracking]);

  // Find nearby speed bumps
  useEffect(() => {
    if (location.latitude && location.longitude) {
      const nearby = speedBumps.filter(bump => {
        const distance = calculateDistance(
          location.latitude,
          location.longitude,
          bump.latitude,
          bump.longitude
        );
        
        // Check if speed bump is ahead or behind
        const isAhead = isSpeedBumpAhead(
          location.latitude, 
          location.longitude, 
          bump.latitude, 
          bump.longitude, 
          direction
        );
        
        // Include if:
        // 1. Speed bump is ahead and within NEARBY_DISTANCE
        // 2. Speed bump is behind but within 200 meters (for short display after passing)
        if (isAhead) {
          return distance <= NEARBY_DISTANCE;
        } else {
          return distance <= 200; // Show behind speed bumps only for 200m
        }
      }).map(bump => {
        const distance = calculateDistance(
          location.latitude, 
          location.longitude, 
          bump.latitude, 
          bump.longitude
        );
        const isAhead = isSpeedBumpAhead(
          location.latitude, 
          location.longitude, 
          bump.latitude, 
          bump.longitude, 
          direction
        );
        
        return {
          ...bump,
          distance: distance,
          isAhead: isAhead
        };
      }).sort((a, b) => {
        // Sort by: ahead first, then by distance
        if (a.isAhead !== b.isAhead) {
          return a.isAhead ? -1 : 1; // Ahead bumps first
        }
        return a.distance - b.distance;
      });
      
      setNearbySpeedBumps(nearby);
      
      // Update danger mode and speed bumps ahead
      const bumpsAhead = nearby.filter(bump => bump.isAhead && bump.distance <= 300); // 300m warning distance
      setSpeedBumpsAhead(bumpsAhead);
      setIsDangerMode(bumpsAhead.length > 0);
      
      // Trigger EXTREME alerts for very close speed bumps (within 150m)
      const veryCloseBumps = bumpsAhead.filter(bump => bump.distance <= 150);
      if (veryCloseBumps.length > 0 && speedBumpsAhead.length === 0) {
        // Only trigger alerts when new speed bumps come into close range
        console.log('🚨 EXTREME ALERT TRIGGERED - SPEED BUMP VERY CLOSE!');
        
        // Audio alert
        playWarningSound();
        
        // Vibration alert
        triggerVibration();
        
        // Set extreme danger mode for ultra-dramatic visuals
        setIsDangerMode(true);
        
        // Flash screen multiple times
        setTimeout(() => setIsDangerMode(false), 200);
        setTimeout(() => setIsDangerMode(true), 400);
        setTimeout(() => setIsDangerMode(false), 600);
        setTimeout(() => setIsDangerMode(true), 800);
      }
    }
  }, [location, speedBumps, calculateDistance, direction, isSpeedBumpAhead, speedBumpsAhead.length, playWarningSound, triggerVibration]);

  // Check direction similarity
  const isDirectionSimilar = useCallback((dir1, dir2, tolerance = 45) => {
    const diff = Math.abs(dir1 - dir2);
    return diff <= tolerance || diff >= (360 - tolerance);
  }, []);

  // Initialize tracking on component mount
  useEffect(() => {
    const cleanup = startTracking();
    return cleanup;
  }, [startTracking]);

    return (
    <div className={`App ${isDangerMode ? 'danger-mode' : ''}`}>
      {isAuthenticating && (
        <div className="auth-overlay">
          <div className="auth-message">
            🔐 Authenticating user...
          </div>
        </div>
      )}

      {!user && !isAuthenticating && (
        <div className="auth-overlay">
          <div className="auth-container">
            <h3>🚗 GPS Obstacle Tracker</h3>
            <p>Sign in with Google to record and track speed bumps</p>
            <div className="auth-buttons">
              <button onClick={signInWithGoogle} className="google-signin-btn">
                🔍 Sign in with Google
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Speed Bumps Area - Top */}
      <div className="speed-bumps-area">
        <div className="speed-bumps-header">
          <div className="header-stats">
            <div className="stats-line">
              📊 {speedBumps.length} bumps • 📍 {location.latitude?.toFixed(4)}, {location.longitude?.toFixed(4)} • 🕐 {Math.floor((Date.now() - lastUpdateTime) / 1000)}s ago
            </div>
          </div>
          <div className="header-buttons">
            <button 
              onClick={toggleFullscreen}
              className="fullscreen-btn"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? '🔳 Exit' : '⛶ Full'}
            </button>
            <button 
              onClick={() => setAutoRefresh(!autoRefresh)} 
              className={`auto-refresh-btn ${autoRefresh ? 'active' : 'inactive'}`}
            >
              {autoRefresh ? '🔄 Auto' : '⏸️ Manual'}
            </button>
            <button 
              onClick={() => {
                if (location.latitude && location.longitude) {
                  const now = Date.now();
                  if (now - lastQueryTime >= QUERY_COOLDOWN) {
                    loadNearbySpeedBumps(location.latitude, location.longitude);
                  }
                }
              }} 
              className="refresh-btn"
              disabled={isLoadingSpeedBumps || !location.latitude}
            >
              {isLoadingSpeedBumps ? '🔄 Loading...' : '🔍 Refresh'}
            </button>
            {user && (
              <button 
                onClick={() => setIsUserInfoVisible(!isUserInfoVisible)} 
                className="toggle-user-info-btn"
              >
                {isUserInfoVisible ? '👤 Hide' : '👤 Info'}
              </button>
            )}
          </div>
        </div>
        

        
        {/* User Info - Only show when toggled visible */}
        {user && isUserInfoVisible && (
          <div className="user-info">
            <div className="user-status">
              <div className="user-details">
                👤 User: {username || 'Loading...'}
                <span className="user-auth-status">
                  🟢 Connected
                </span>
              </div>
              <button onClick={handleSignOut} className="signout-btn">
                🚪 Sign Out
              </button>
            </div>
          </div>
        )}
        
        <div className="nearby-speed-bumps">
          {isLoadingSpeedBumps ? (
            <div className="loading-speed-bumps">
              <div className="loading-spinner">🔄</div>
              <p>Loading nearby speed bumps...</p>
            </div>
          ) : nearbySpeedBumps.length > 0 ? (
            nearbySpeedBumps.map((bump) => {
              const distance = bump.distance || calculateDistance(
                location.latitude,
                location.longitude,
                bump.latitude,
                bump.longitude
              );
              
              const isAhead = bump.isAhead !== undefined ? bump.isAhead : true;
              const isSameDirection = isDirectionSimilar(direction, bump.direction);
              
              return (
                <div 
                  key={bump.id} 
                  className={`speed-bump-warning ${isSameDirection ? 'same-direction' : 'opposite-direction'} ${isAhead ? 'ahead' : 'behind'}`}
                  onClick={() => deleteSpeedBump(bump.id)}
                  style={{ cursor: user ? 'pointer' : 'default' }}
                  title={user ? "Click to delete this speed bump" : "Sign in to delete speed bumps"}
                >
                  <div className="bump-distance">
                    {Math.round(distance)}m {isAhead ? 'ahead' : 'behind'}
                  </div>
                  <div className="bump-direction">
                    {isAhead ? (
                      isSameDirection ? 
                        `⚠️ Speed Bump AHEAD in your direction (${bump.compassDirection})` :
                        `ℹ️ Speed Bump ahead in opposite direction (${bump.compassDirection})`
                    ) : (
                      `✓ Speed Bump behind (${bump.compassDirection})`
                    )}
                  </div>
                  <div className="bump-speed">Safe speed: {Math.round(bump.speed)} km/h</div>
                  <div className="bump-reporter">
                    👤 Reported by: {bump.username || `User_${bump.userId?.slice(-8)}` || 'Unknown'}
                  </div>
                  {user && (
                    <div className="delete-hint">
                      🗑️ Click to delete
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="no-speed-bumps">
              {isTracking ? "🛣️ No speed bumps detected ahead" : "📡 Waiting for GPS..."}
            </div>
          )}
        </div>
      </div>

      {/* Car Dashboard - Bottom */}
      <div 
        className={`car-dashboard ${user ? 'clickable-dashboard' : ''} ${isRecordingSpeedBump ? 'recording' : ''}`}
        onClick={user && !isRecordingSpeedBump && location.latitude ? recordSpeedBump : undefined}
        style={{ cursor: user && !isRecordingSpeedBump && location.latitude ? 'pointer' : 'default' }}
      >
        <div className="car-icon-section">
          <DirectionsCarIcon className="car-icon" />
          <div className={`gps-status ${isTracking ? 'active' : 'inactive'}`}>
            {isTracking ? 'GPS' : 'NO GPS'}
          </div>
        </div>
        
        <div className="dashboard-info">
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">LAT</span>
              <span className="info-value">
                {location.latitude ? location.latitude.toFixed(6) : 'Waiting...'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">LON</span>
              <span className="info-value">
                {location.longitude ? location.longitude.toFixed(6) : 'Waiting...'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">DIRECTION</span>
              <span className="info-value">{getCompassDirection(direction)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">SPEED</span>
              <span className="info-value">{Math.round(speed)} km/h</span>
            </div>
          </div>
        </div>
        
        {/* Speed Bump Recording Indicator */}
        {user && (
          <div className="dashboard-action-indicator">
            {isRecordingSpeedBump ? (
              <div className="recording-indicator">
                <div className="recording-pulse">🔄</div>
                <div className="recording-text">Recording...</div>
              </div>
            ) : !location.latitude ? (
              <div className="waiting-gps">
                <div className="waiting-text">📍 Waiting for GPS...</div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
