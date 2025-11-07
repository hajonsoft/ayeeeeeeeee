import React, { useState, useEffect, useCallback } from 'react';
import { collection, addDoc, query, where, onSnapshot } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
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

  const NEARBY_DISTANCE = 500; // meters - for display
  const QUERY_RADIUS = 50; // kilometers - for database query
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

  // Anonymous Sign In
  const signInAnonymouslyHandler = useCallback(async () => {
    try {
      setIsAuthenticating(true);
      await signInAnonymously(auth);
      console.log('Anonymous sign-in successful');
    } catch (error) {
      console.error('Anonymous sign-in error:', error);
      setIsAuthenticating(false);
      alert('Failed to sign in anonymously. Please try again.');
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
      
      console.log(`Querying speed bumps within ${radius}km of ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      
      // Create Firestore query with geographic bounds
      const q = query(
        collection(db, 'speedBumps'),
        where('latitude', '>=', bounds.south),
        where('latitude', '<=', bounds.north),
        where('longitude', '>=', bounds.west),
        where('longitude', '<=', bounds.east)
      );

      // Listen for real-time updates
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const bumps = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Additional distance filtering to ensure circular radius
          const distance = calculateDistance(lat, lng, data.latitude, data.longitude);
          if (distance <= radius * 1000) { // Convert km to meters
            bumps.push({
              id: doc.id,
              ...data
            });
          }
        });
        
        // Sort by distance
        bumps.sort((a, b) => {
          const distanceA = calculateDistance(lat, lng, a.latitude, a.longitude);
          const distanceB = calculateDistance(lat, lng, b.latitude, b.longitude);
          return distanceA - distanceB;
        });
        
        console.log(`Loaded ${bumps.length} speed bumps from database`);
        setSpeedBumps(bumps);
        setIsLoadingSpeedBumps(false);
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
      alert('GPS location not available. Please wait for GPS lock.');
      return;
    }

    if (!user) {
      alert('Authentication required. Please wait a moment and try again.');
      return;
    }

    try {
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
      alert(`Speed bump recorded successfully!\nID: ${docRef.id}\nUser: ${username}`);
      
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
      
      // Provide specific error messages
      if (error.code === 'permission-denied') {
        alert('Permission denied. Please check Firebase security rules.');
      } else if (error.code === 'unavailable') {
        alert('Database temporarily unavailable. Please check your internet connection.');
      } else {
        alert(`Failed to record speed bump: ${error.message}`);
      }
    }
  }, [location, direction, speed, getCompassDirection, user, username, autoRefresh, loadNearbySpeedBumps]);

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
        return distance <= NEARBY_DISTANCE;
      }).sort((a, b) => {
        const distanceA = calculateDistance(location.latitude, location.longitude, a.latitude, a.longitude);
        const distanceB = calculateDistance(location.latitude, location.longitude, b.latitude, b.longitude);
        return distanceA - distanceB;
      });
      
      setNearbySpeedBumps(nearby);
    }
  }, [location, speedBumps, calculateDistance]);

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
    <div className="App">
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
            <p>Please sign in to record and track speed bumps</p>
            <div className="auth-buttons">
              <button onClick={signInWithGoogle} className="google-signin-btn">
                🔍 Sign in with Google
              </button>
              <button onClick={signInAnonymouslyHandler} className="anonymous-signin-btn">
                👤 Continue as Guest
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Speed Bumps Area - Top */}
      <div className="speed-bumps-area">
        <div className="speed-bumps-header">
          <h3>Upcoming Speed Bumps</h3>
          <div className="header-buttons">
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
                  } else {
                    const remainingTime = Math.ceil((QUERY_COOLDOWN - (now - lastQueryTime)) / 1000);
                    alert(`Please wait ${remainingTime} more seconds before refreshing.`);
                  }
                }
              }} 
              className="refresh-btn"
              disabled={isLoadingSpeedBumps || !location.latitude}
            >
              {isLoadingSpeedBumps ? '🔄 Loading...' : '🔍 Refresh'}
            </button>
            <button 
              onClick={recordSpeedBump} 
              className="record-speed-bump-btn"
              disabled={!user || !location.latitude || isAuthenticating}
            >
              🚧 Mark Speed Bump
            </button>
          </div>
        </div>
        
        <div className="user-info">
          <div className="user-status">
            <div className="user-details">
              👤 User: {username || 'Not signed in'}
              <span className="user-auth-status">
                {user ? '🟢 Connected' : '🔴 Not authenticated'}
              </span>
            </div>
            {user && (
              <button onClick={handleSignOut} className="signout-btn">
                🚪 Sign Out
              </button>
            )}
          </div>
        </div>
        
        <div className="query-info">
          <div className="query-stats">
            📊 Loaded: {speedBumps.length} speed bumps within {QUERY_RADIUS}km
            {lastQueryLocation && (
              <span className="query-location">
                📍 Query center: {lastQueryLocation.latitude.toFixed(4)}, {lastQueryLocation.longitude.toFixed(4)}
              </span>
            )}
            {lastQueryTime > 0 && (
              <span className="query-time">
                🕐 Last update: {Math.floor((Date.now() - lastQueryTime) / 1000)}s ago
                {Date.now() - lastQueryTime < QUERY_COOLDOWN && (
                  <span className="cooldown"> (Cooldown: {Math.ceil((QUERY_COOLDOWN - (Date.now() - lastQueryTime)) / 1000)}s)</span>
                )}
              </span>
            )}
          </div>
        </div>        <div className="nearby-speed-bumps">
          {isLoadingSpeedBumps ? (
            <div className="loading-speed-bumps">
              <div className="loading-spinner">🔄</div>
              <p>Loading nearby speed bumps...</p>
            </div>
          ) : nearbySpeedBumps.length > 0 ? (
            nearbySpeedBumps.slice(0, 3).map(bump => {
              const distance = calculateDistance(
                location.latitude || 0,
                location.longitude || 0,
                bump.latitude,
                bump.longitude
              );
              const isSameDirection = isDirectionSimilar(direction, bump.direction);
              
              return (
                <div key={bump.id} className={`speed-bump-warning ${isSameDirection ? 'same-direction' : 'opposite-direction'}`}>
                  <div className="bump-distance">{Math.round(distance)}m ahead</div>
                  <div className="bump-direction">
                    {isSameDirection ? 
                      `⚠️ Speed Bump in your direction (${bump.compassDirection})` :
                      `ℹ️ Speed Bump in opposite direction (${bump.compassDirection})`
                    }
                  </div>
                  <div className="bump-speed">Safe speed: {Math.round(bump.speed)} km/h</div>
                  <div className="bump-reporter">
                    👤 Reported by: {bump.username || `User_${bump.userId?.slice(-8)}` || 'Unknown'}
                  </div>
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
      <div className="car-dashboard">
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
      </div>
    </div>
  );
}

export default App;
