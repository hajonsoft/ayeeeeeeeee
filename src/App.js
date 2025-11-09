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
  const [testMode, setTestMode] = useState('setup'); // 'setup', 'ready', 'running'
  const [speedBumpMinDistances, setSpeedBumpMinDistances] = useState({}); // Track closest we've been to each bump
  const [speedBumpPrevDistances, setSpeedBumpPrevDistances] = useState({}); // Track previous distance to each bump

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

  // Simple speed bump tracking - tracks closest distance and current trend
  const isSpeedBumpAhead = useCallback((currentLat, currentLng, bumpLat, bumpLng, movementDirection, previousLat = null, previousLng = null, bumpId) => {
    const currentDistance = calculateDistance(currentLat, currentLng, bumpLat, bumpLng);
    
    // Track minimum distance we've been to this bump
    const currentMinDistance = speedBumpMinDistances[bumpId] || currentDistance;
    const newMinDistance = Math.min(currentMinDistance, currentDistance);
    
    // Track previous distance for better movement detection
    const prevDistance = speedBumpPrevDistances[bumpId] || currentDistance;
    
    // Update state
    if (newMinDistance !== currentMinDistance) {
      setSpeedBumpMinDistances(prev => ({
        ...prev,
        [bumpId]: newMinDistance
      }));
    }
    
    setSpeedBumpPrevDistances(prev => ({
      ...prev,
      [bumpId]: currentDistance
    }));
    
    const haveBeenClose = newMinDistance < 20; // Within 20m at some point
    const distanceChange = currentDistance - prevDistance; // Positive means moving away
    const isMovingAway = distanceChange > 0.5; // Moving away by at least 0.5m
    const farFromMin = currentDistance > (newMinDistance + 15); // More than 15m past minimum
    
    // Debug logging
    if (process.env.NODE_ENV === 'development' && currentDistance < 100) {
      console.log(`🚦 Bump ${bumpId.slice(-4)}: Distance ${currentDistance.toFixed(1)}m (min: ${newMinDistance.toFixed(1)}m)`);
      console.log(`  HaveBeenClose: ${haveBeenClose} (${newMinDistance.toFixed(1)} < 20)`);
      console.log(`  DistanceChange: ${distanceChange.toFixed(1)}m (from prev ${prevDistance.toFixed(1)}m)`);
      console.log(`  IsMovingAway: ${isMovingAway} (change > 0.5)`);
      console.log(`  FarFromMin: ${farFromMin} (${currentDistance.toFixed(1)} > ${(newMinDistance + 15).toFixed(1)})`);
    }
    
    // If we've been close and are now moving away and far from minimum, it's behind us
    if (haveBeenClose && isMovingAway && farFromMin) {
      if (process.env.NODE_ENV === 'development' && currentDistance < 100) {
        console.log(`  → BEHIND`);
      }
      return false;
    }
    
    if (process.env.NODE_ENV === 'development' && currentDistance < 100) {
      console.log(`  → AHEAD`);
    }
    return true;
  }, [calculateDistance, speedBumpMinDistances, setSpeedBumpMinDistances, speedBumpPrevDistances, setSpeedBumpPrevDistances]);

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

  // Handle new position data with enhanced speed calculation
  const handlePositionUpdate = useCallback((position) => {
    const { latitude, longitude, accuracy, speed: gpsSpeed } = position.coords;
    const currentTime = Date.now();
    
    setLocation({ latitude, longitude, accuracy });

    // Enhanced speed calculation with better fallbacks
    let calculatedSpeed = 0;
    
    // Priority 1: Use GPS speed if reliable
    if (gpsSpeed !== null && gpsSpeed !== undefined && gpsSpeed >= 0) {
      calculatedSpeed = gpsSpeed * 3.6; // Convert m/s to km/h
    } 
    // Priority 2: Calculate from position changes
    else if (previousLocation && currentTime - lastUpdateTime > 300) { // Reduced interval to 300ms for better responsiveness
      const distance = calculateDistance(
        previousLocation.latitude,
        previousLocation.longitude,
        latitude,
        longitude
      );
      
      const timeInterval = currentTime - lastUpdateTime;
      
      // Calculate speed even for small movements to be more responsive
      if (distance > 1.0 && timeInterval > 500) { // Increased minimum distance back to 1m and time to 500ms
        const speedMPS = distance / (timeInterval / 1000);
        calculatedSpeed = Math.max(0, speedMPS * 3.6); // Convert to km/h
      } else if (distance <= 1.0) {
        // If barely moving, set speed to 0
        calculatedSpeed = 0;
      } else {
        // Keep previous speed for very short time intervals
        calculatedSpeed = speed;
      }
    }
    // Priority 3: Keep current speed if no data available
    else {
      calculatedSpeed = speed;
    }

    // Improved speed smoothing - less aggressive to be more responsive
    setSpeed(prevSpeed => {
      // Use less smoothing when speed is increasing (acceleration)
      const smoothingFactor = calculatedSpeed > prevSpeed ? 0.4 : 0.6;
      const smoothedSpeed = prevSpeed * (1 - smoothingFactor) + calculatedSpeed * smoothingFactor;
      const finalSpeed = Math.max(0, Math.round(smoothedSpeed * 10) / 10); // Round to 1 decimal
      
      if (Math.abs(finalSpeed - prevSpeed) > 2.0) {
        console.log(`⚡ Speed updated: ${prevSpeed.toFixed(1)} → ${finalSpeed.toFixed(1)} km/h`);
      }
      
      return finalSpeed;
    });

    if (previousLocation && currentTime - lastUpdateTime > 500) { // Increased back to 500ms for stable direction updates
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
          timeout: 10000, // Increased timeout for better GPS lock
          maximumAge: 1000 // Allow 1 second old readings for better performance
        }
      );
      
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      alert('Geolocation is not supported by this browser.');
      return () => {}; // Return empty function if geolocation not supported
    }
  }, [handlePositionUpdate]);

  // GPS Driving Simulator for Testing (Development Only)
  const startDrivingSimulation = useCallback((options = {}) => {
    const {
      startLat = 37.7749,     // San Francisco starting point
      startLng = -122.4194,
      direction = 90,         // 90 = East, 0 = North, 180 = South, 270 = West
      duration = 60,          // seconds
      maxSpeed = 50,          // km/h
      updateInterval = 1000   // ms
    } = options;

    let currentLat = startLat;
    let currentLng = startLng;
    let currentSpeed = 0;
    let elapsedTime = 0;
    
    console.log('🚗 Starting GPS Driving Simulation');
    
    const simulation = setInterval(() => {
      elapsedTime += updateInterval / 1000;
      
      // Simulate realistic speed changes
      if (elapsedTime < 10) {
        // Acceleration phase (0-10 seconds)
        currentSpeed = (elapsedTime / 10) * maxSpeed;
      } else if (elapsedTime > duration - 10) {
        // Deceleration phase (last 10 seconds)
        const timeToStop = duration - elapsedTime;
        currentSpeed = (timeToStop / 10) * maxSpeed;
      } else {
        // Cruising phase with slight variations
        const variation = Math.sin(elapsedTime * 0.1) * 5; // ±5 km/h variation
        currentSpeed = maxSpeed + variation;
      }
      
      currentSpeed = Math.max(0, Math.min(currentSpeed, maxSpeed));
      
      // Calculate distance moved in this interval
      const speedMPS = currentSpeed / 3.6; // Convert km/h to m/s
      const distanceMeters = speedMPS * (updateInterval / 1000);
      
      // Convert direction to radians and calculate new position
      const directionRad = (direction * Math.PI) / 180;
      const earthRadius = 6371000; // Earth radius in meters
      
      // Calculate bearing offset (lat/lng delta)
      const deltaLat = (distanceMeters * Math.cos(directionRad)) / earthRadius;
      const deltaLng = (distanceMeters * Math.sin(directionRad)) / (earthRadius * Math.cos(currentLat * Math.PI / 180));
      
      // Update position
      currentLat += deltaLat * (180 / Math.PI);
      currentLng += deltaLng * (180 / Math.PI);
      
      // Create mock GPS position
      const mockPosition = {
        coords: {
          latitude: currentLat,
          longitude: currentLng,
          accuracy: 5,
          speed: speedMPS // GPS speed in m/s
        },
        timestamp: Date.now()
      };
      
      // Update app with simulated position
      handlePositionUpdate(mockPosition);
      
      // Stop simulation when duration reached
      if (elapsedTime >= duration) {
        clearInterval(simulation);
        console.log('🏁 Driving simulation completed!');
        console.log(`📍 End: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`);
        
        // Add to window object for easy console access
        window.simulationEndPosition = { lat: currentLat, lng: currentLng };
        console.log('💡 End position saved as window.simulationEndPosition');
      }
    }, updateInterval);
    
    // Return simulation control object
    const controller = {
      stop: () => {
        clearInterval(simulation);
        console.log('⏹️ Simulation stopped manually');
      },
      getCurrentPosition: () => ({ lat: currentLat, lng: currentLng, speed: currentSpeed })
    };
    
    // Make it globally accessible
    window.drivingSimulation = controller;
    console.log('💡 Simulation saved as window.drivingSimulation (use .stop() to end early)');
    
    return controller;
  }, [handlePositionUpdate]);

  // Make simulation functions globally accessible for console testing
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      // Make main simulation function available
      window.startDrivingSimulation = startDrivingSimulation;
      
      // Helper function to add speed bump at specific coordinates
      window.addSpeedBumpHere = (lat, lng) => {
        if (!lat || !lng) {
          console.log('❌ Please provide latitude and longitude: addSpeedBumpHere(lat, lng)');
          return;
        }
        
        console.log(`📌 Adding speed bump at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        
        const mockBump = {
          id: `test-${Date.now()}`,
          latitude: lat,
          longitude: lng,
          direction: direction,
          compassDirection: getCompassDirection(direction),
          userId: user?.uid || 'test-user',
          timestamp: new Date().toISOString()
        };
        
        setSpeedBumps(prev => [...prev, mockBump]);
        console.log('✅ Speed bump added for testing!');
      };
      
      // Helper to create speed bumps along a route
      window.createTestRoute = (startLat, startLng, endLat, endLng, bumpCount = 3) => {
        console.log(`🛣️ Creating test route with ${bumpCount} speed bumps`);
        
        for (let i = 0; i < bumpCount; i++) {
          const progress = (i + 1) / (bumpCount + 1); // Distribute evenly along route
          const lat = startLat + (endLat - startLat) * progress;
          const lng = startLng + (endLng - startLng) * progress;
          
          window.addSpeedBumpHere(lat, lng);
        }
        
        console.log(`✅ Created ${bumpCount} test speed bumps along route`);
      };
      
      // Quick test scenarios
      window.runQuickTest = () => {
        console.log('🚀 Setting up quick test scenario...');
        console.log('📋 This will create speed bumps for testing');
        
        // Create a straight eastward route with speed bumps
        const startLat = 37.7749;
        const startLng = -122.4194;
        const endLat = 37.7749;
        const endLng = -122.4100; // About 1km east
        
        // Add 3 speed bumps along the route
        window.createTestRoute(startLat, startLng, endLat, endLng, 3);
        
        console.log('✅ Speed bumps added to test route');
        console.log('🚗 Now run: startDrivingSimulation() to begin driving test');
        console.log('💡 Or customize: startDrivingSimulation({ maxSpeed: 60, duration: 120 })');
      };
      
      // Real GPS tracking function
      window.startGPSTracking = () => {
        console.log('📡 Starting real GPS tracking...');
        startTracking();
      };
    }
  }, [startDrivingSimulation, direction, user?.uid, getCompassDirection, startTracking]);

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

  // Enhanced fullscreen functionality with mobile support
  const toggleFullscreen = useCallback(async () => {
    try {
      const elem = document.documentElement;
      
      // Check if already in fullscreen
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      
      if (!isCurrentlyFullscreen) {
        // Request fullscreen with fallbacks for different browsers
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          // Safari & Chrome iOS
          await elem.webkitRequestFullscreen();
        } else if (elem.webkitRequestFullScreen) {
          // Older webkit
          await elem.webkitRequestFullScreen();
        } else if (elem.mozRequestFullScreen) {
          // Firefox
          await elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
          // IE/Edge
          await elem.msRequestFullscreen();
        } else {
          // Mobile fallback - hide browser UI
          window.scrollTo(0, 1);
          setTimeout(() => window.scrollTo(0, 0), 0);
        }
        setIsFullscreen(true);
      } else {
        // Exit fullscreen with fallbacks
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.webkitCancelFullScreen) {
          await document.webkitCancelFullScreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
      // Mobile fallback for when fullscreen APIs fail
      if (/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) {
        // Add viewport meta tag manipulation for mobile
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
          if (!isFullscreen) {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=no, minimal-ui');
          } else {
            viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=yes');
          }
        }
        setIsFullscreen(!isFullscreen);
      }
    }
  }, [isFullscreen]);

  // Listen for fullscreen changes with mobile support
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      );
      setIsFullscreen(isCurrentlyFullscreen);
    };

    // Add listeners for all browser variants
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
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

  // Initialize GPS tracking automatically (only on mobile devices)
  useEffect(() => {
    // Check if device is mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    
    if (isMobile) {
      const cleanup = startTracking();
      return () => {
        if (cleanup && typeof cleanup === 'function') {
          cleanup();
        }
      };
    } else {
      // Desktop - GPS tracking manual only
    }
  }, [startTracking]);

  // Cleanup speed bump tracking when bumps are removed
  useEffect(() => {
    const currentBumpIds = speedBumps.map(bump => bump.id);
    setSpeedBumpMinDistances(prevDistances => {
      const filteredDistances = {};
      currentBumpIds.forEach(id => {
        if (prevDistances[id] !== undefined) {
          filteredDistances[id] = prevDistances[id];
        }
      });
      return filteredDistances;
    });
    
    setSpeedBumpPrevDistances(prevDistances => {
      const filteredDistances = {};
      currentBumpIds.forEach(id => {
        if (prevDistances[id] !== undefined) {
          filteredDistances[id] = prevDistances[id];
        }
      });
      return filteredDistances;
    });
  }, [speedBumps]);

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
          direction,
          previousLocation?.latitude,
          previousLocation?.longitude,
          bump.id
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
          direction,
          previousLocation?.latitude,
          previousLocation?.longitude,
          bump.id
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
      
      // Update danger mode and speed bumps ahead
      const bumpsAhead = nearby.filter(bump => bump.isAhead && bump.distance <= 300); // 300m warning distance
      setSpeedBumpsAhead(bumpsAhead);
      setIsDangerMode(bumpsAhead.length > 0);
      
      // Limit display to only the closest bump ahead and closest bump behind
      const closestAhead = nearby.filter(bump => bump.isAhead).slice(0, 1); // Only closest ahead
      const closestBehind = nearby.filter(bump => !bump.isAhead && bump.distance <= 200).slice(0, 1); // Only closest behind within 200m
      const limitedNearby = [...closestAhead, ...closestBehind];
      setNearbySpeedBumps(limitedNearby);
      
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
  }, [location, speedBumps, calculateDistance, direction, isSpeedBumpAhead, speedBumpsAhead.length, playWarningSound, triggerVibration, previousLocation, speedBumpMinDistances, speedBumpPrevDistances]);

  // Check direction similarity
  const isDirectionSimilar = useCallback((dir1, dir2, tolerance = 45) => {
    const diff = Math.abs(dir1 - dir2);
    return diff <= tolerance || diff >= (360 - tolerance);
  }, []);

  // Initialize tracking on component mount
  // Removed duplicate GPS auto-start - GPS tracking now manual only
  // Use window.startGPSTracking() to begin real GPS tracking
  
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
            
            {/* Test button for desktop/development only */}
            {(process.env.NODE_ENV === 'development' || window.innerWidth >= 768) && (
              <button 
                onClick={() => {
                  if (testMode === 'setup' || testMode === 'ready') {
                    console.log('🚗 Starting GPS driving simulation...');
                    setTestMode('running');
                    
                    // Start the driving simulation without any speed bumps
                    startDrivingSimulation({
                      startLat: 37.7749,
                      startLng: -122.4194,
                      direction: 90, // East
                      duration: 300, // 5 minutes to give time for testing
                      maxSpeed: 50
                    });
                    
                    console.log('🏁 Simulation started! Add speed bumps manually to test detection.');
                    console.log('💡 Click the dashboard or use console to add speed bumps.');
                    
                  } else {
                    // Stop simulation and reset
                    console.log('🔄 Stopping simulation...');
                    setTestMode('setup');
                    
                    // Stop any running simulation
                    if (window.drivingSimulation) {
                      window.drivingSimulation.stop();
                    }
                    
                    console.log('✅ Simulation stopped. Click Test to start again.');
                  }
                }}
                className="test-btn"
                title={
                  testMode === 'running' ? 'Stop GPS simulation' : 'Start GPS driving simulation'
                }
              >
                {testMode === 'running' ? '⏹️ Stop' : '🚗 Drive'}
              </button>
            )}
            
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
            
            {/* GPS Start button for desktop only */}
            {window.innerWidth >= 768 && !isTracking && (
              <button 
                onClick={() => {
                  console.log('📡 Starting GPS tracking manually...');
                  startTracking();
                }}
                className="gps-start-btn"
                title="Start real GPS tracking (Desktop only)"
              >
                📡 GPS
              </button>
            )}
            
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
