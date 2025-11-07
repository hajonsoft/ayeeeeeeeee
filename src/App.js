import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

function App() {
  const [location, setLocation] = useState({
    latitude: null,
    longitude: null,
    accuracy: null
  });
  const [speed, setSpeed] = useState(0);
  const [direction, setDirection] = useState(0);
  const [speedHistory, setSpeedHistory] = useState([]);
  const [previousLocation, setPreviousLocation] = useState(null);
  const [speedBumps, setSpeedBumps] = useState([]);
  const [scannedRoads, setScannedRoads] = useState([]);
  const [showSpeedBumpButton, setShowSpeedBumpButton] = useState(false);
  const [isTracking, setIsTracking] = useState(false);

  // Speed bump detection threshold (km/h)
  const SPEED_BUMP_THRESHOLD = 20;

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

  // Calculate speed from distance and time
  const calculateSpeed = useCallback((distance, timeInterval) => {
    // Speed in m/s, convert to km/h
    const speedMPS = distance / (timeInterval / 1000);
    return speedMPS * 3.6; // Convert m/s to km/h
  }, []);

  // Get compass direction from bearing
  const getCompassDirection = useCallback((bearing) => {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }, []);

  // Handle new position data
  const handlePositionUpdate = useCallback((position) => {
    const { latitude, longitude, accuracy } = position.coords;
    const currentTime = Date.now();
    
    setLocation({ latitude, longitude, accuracy });

    if (previousLocation) {
      const distance = calculateDistance(
        previousLocation.latitude,
        previousLocation.longitude,
        latitude,
        longitude
      );
      
      const timeInterval = currentTime - previousLocation.timestamp;
      
      // Only calculate speed if we moved significantly and time elapsed
      if (distance > 1 && timeInterval > 1000) { // Moved at least 1m and 1s elapsed
        const newSpeed = calculateSpeed(distance, timeInterval);
        const newDirection = calculateBearing(
          previousLocation.latitude,
          previousLocation.longitude,
          latitude,
          longitude
        );
        
        setSpeed(newSpeed);
        setDirection(newDirection);
        
        // Update speed history for speed bump detection
        setSpeedHistory(prev => {
          const newHistory = [...prev, newSpeed].slice(-10); // Keep last 10 readings
          
          // Check for potential speed bump (sudden speed reduction)
          if (newHistory.length >= 3) {
            const recentSpeeds = newHistory.slice(-3);
            const avgSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
            
            if (avgSpeed < SPEED_BUMP_THRESHOLD && newSpeed < 15) {
              setShowSpeedBumpButton(true);
            }
          }
          
          return newHistory;
        });
      }
    }
    
    setPreviousLocation({ latitude, longitude, timestamp: currentTime });
  }, [previousLocation, calculateDistance, calculateSpeed, calculateBearing]);

  // Start GPS tracking
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
          timeout: 10000,
          maximumAge: 1000
        }
      );
      
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      alert('Geolocation is not supported by this browser.');
    }
  }, [handlePositionUpdate]);

  // Record speed bump
  const recordSpeedBump = useCallback(() => {
    if (location.latitude && location.longitude) {
      const speedBump = {
        id: Date.now(),
        latitude: location.latitude,
        longitude: location.longitude,
        direction: direction,
        safeSpeed: Math.max(...speedHistory.slice(-5)), // Max speed in last 5 readings
        timestamp: new Date().toISOString(),
        compassDirection: getCompassDirection(direction)
      };
      
      setSpeedBumps(prev => [...prev, speedBump]);
      setShowSpeedBumpButton(false);
      
      // Mark this road segment as scanned
      const roadSegment = {
        id: Date.now(),
        startLat: location.latitude,
        startLon: location.longitude,
        direction: direction,
        timestamp: new Date().toISOString()
      };
      
      setScannedRoads(prev => [...prev, roadSegment]);
      
      alert('Speed bump recorded successfully!');
    }
  }, [location, direction, speedHistory, getCompassDirection]);

  // Initialize tracking on component mount
  useEffect(() => {
    const cleanup = startTracking();
    return cleanup;
  }, [startTracking]);

  return (
    <div className="App">
      <div className="gps-dashboard">
        <h1>GPS Obstacle Tracker</h1>
        
        {/* GPS Status */}
        <div className="status-panel">
          <div className={`status-indicator ${isTracking ? 'active' : 'inactive'}`}>
            {isTracking ? '📡 GPS Active' : '📡 GPS Inactive'}
          </div>
        </div>

        {/* Navigation Arrow */}
        <div className="navigation-panel">
          <div 
            className="direction-arrow" 
            style={{ transform: `rotate(${direction}deg)` }}
          >
            ↑
          </div>
          <div className="compass-direction">
            {getCompassDirection(direction)}
          </div>
        </div>

        {/* Location Data */}
        <div className="data-panel">
          <div className="data-row">
            <label>Latitude:</label>
            <span>{location.latitude ? location.latitude.toFixed(6) : 'Waiting...'}</span>
          </div>
          <div className="data-row">
            <label>Longitude:</label>
            <span>{location.longitude ? location.longitude.toFixed(6) : 'Waiting...'}</span>
          </div>
          <div className="data-row">
            <label>Speed:</label>
            <span>{speed.toFixed(1)} km/h</span>
          </div>
          <div className="data-row">
            <label>Direction:</label>
            <span>{direction.toFixed(0)}° ({getCompassDirection(direction)})</span>
          </div>
          <div className="data-row">
            <label>Accuracy:</label>
            <span>{location.accuracy ? `${location.accuracy.toFixed(0)}m` : 'N/A'}</span>
          </div>
        </div>

        {/* Speed Bump Detection */}
        {showSpeedBumpButton && (
          <div className="speed-bump-alert">
            <p>⚠️ Slow speed detected! Possible speed bump?</p>
            <button onClick={recordSpeedBump} className="record-button">
              Mark Speed Bump
            </button>
            <button 
              onClick={() => setShowSpeedBumpButton(false)} 
              className="dismiss-button"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Recorded Speed Bumps */}
        <div className="speed-bumps-panel">
          <h3>Recorded Speed Bumps ({speedBumps.length})</h3>
          <div className="speed-bumps-list">
            {speedBumps.slice(-5).map(bump => (
              <div key={bump.id} className="speed-bump-item">
                <div className="bump-location">
                  📍 {bump.latitude.toFixed(6)}, {bump.longitude.toFixed(6)}
                </div>
                <div className="bump-details">
                  Direction: {bump.compassDirection} | Safe Speed: {bump.safeSpeed.toFixed(1)} km/h
                </div>
                <div className="bump-time">
                  {new Date(bump.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scanned Roads */}
        <div className="scanned-roads-panel">
          <h3>Scanned Road Segments ({scannedRoads.length})</h3>
          <p>Roads that have been monitored for obstacles</p>
        </div>
      </div>
    </div>
  );
}

export default App;
