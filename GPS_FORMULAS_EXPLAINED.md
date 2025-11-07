# GPS Obstacle Detection App - Mathematical Formulas Explained

## Overview
This application tracks your location using GPS and detects potential speed bumps by monitoring speed changes. It uses several mathematical formulas to calculate distance, speed, and direction from GPS coordinates.

## Core Mathematical Formulas

### 1. Distance Calculation - Haversine Formula

The Haversine formula calculates the great-circle distance between two points on Earth given their latitude and longitude coordinates.

**Formula:**
```
a = sin²(Δφ/2) + cos(φ1) × cos(φ2) × sin²(Δλ/2)
c = 2 × atan2(√a, √(1−a))
d = R × c
```

Where:
- φ1, φ2 = latitude of point 1 and point 2 (in radians)
- Δφ = φ2 - φ1 (difference in latitudes)
- Δλ = λ2 - λ1 (difference in longitudes)
- R = Earth's radius (6,371,000 meters)
- d = distance in meters

**Implementation in Code:**
```javascript
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in meters
};
```

### 2. Speed Calculation

Speed is calculated using the basic formula: Speed = Distance / Time

**Formula:**
```
Speed (m/s) = Distance (meters) / Time (seconds)
Speed (km/h) = Speed (m/s) × 3.6
```

**Implementation in Code:**
```javascript
const calculateSpeed = (distance, timeInterval) => {
  const speedMPS = distance / (timeInterval / 1000);
  return speedMPS * 3.6; // Convert m/s to km/h
};
```

### 3. Direction/Bearing Calculation

The bearing (direction) between two GPS points is calculated using the forward azimuth formula.

**Formula:**
```
y = sin(Δλ) × cos(φ2)
x = cos(φ1) × sin(φ2) - sin(φ1) × cos(φ2) × cos(Δλ)
θ = atan2(y, x)
```

Where:
- θ = bearing in radians (convert to degrees and normalize to 0-360°)
- φ1, φ2 = latitude of point 1 and point 2 (in radians)
- Δλ = difference in longitudes (in radians)

**Implementation in Code:**
```javascript
const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360; // Normalize to 0-360 degrees
};
```

### 4. Compass Direction Conversion

Converts numerical bearing (0-360°) to compass directions:

```javascript
const getCompassDirection = (bearing) => {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(bearing / 45) % 8;
  return directions[index];
};
```

## Speed Bump Detection Algorithm

The app detects potential speed bumps by monitoring speed patterns:

1. **Speed History Tracking**: Maintains a rolling window of the last 10 speed readings
2. **Threshold Detection**: When average speed drops below 20 km/h and current speed is below 15 km/h
3. **Pattern Recognition**: Looks for sudden speed reductions that indicate obstacle avoidance

```javascript
// Speed bump detection logic
if (newHistory.length >= 3) {
  const recentSpeeds = newHistory.slice(-3);
  const avgSpeed = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
  
  if (avgSpeed < SPEED_BUMP_THRESHOLD && newSpeed < 15) {
    setShowSpeedBumpButton(true);
  }
}
```

## Data Storage Structure

### Speed Bump Records
```javascript
{
  id: timestamp,
  latitude: precise GPS latitude,
  longitude: precise GPS longitude,
  direction: bearing in degrees (0-360),
  safeSpeed: maximum safe speed through obstacle,
  timestamp: ISO date string,
  compassDirection: human-readable direction (N, NE, E, etc.)
}
```

### Road Segment Records
```javascript
{
  id: timestamp,
  startLat: segment starting latitude,
  startLon: segment starting longitude,
  direction: travel direction when scanned,
  timestamp: ISO date string
}
```

## Accuracy Considerations

1. **GPS Accuracy**: Depends on device GPS capability (typically 3-5 meters)
2. **Speed Calculation**: More accurate with higher GPS sampling rates
3. **Direction Accuracy**: Requires movement to calculate reliable bearings
4. **Speed Bump Detection**: May produce false positives in traffic or turns

## Future Enhancements

1. **Database Integration**: Store speed bump data in persistent storage
2. **Route Prediction**: Warn drivers of upcoming speed bumps based on travel direction
3. **Machine Learning**: Improve speed bump detection accuracy with ML algorithms
4. **Crowd Sourcing**: Validate speed bump reports from multiple users
5. **Map Integration**: Display speed bumps on an interactive map interface

## Usage Tips

1. **Enable High Accuracy GPS**: Ensure location services are set to high accuracy
2. **Stable Mounting**: Mount device securely to reduce GPS noise
3. **Calibration**: Drive normally to establish baseline speed patterns
4. **Verification**: Manually verify speed bump detections for accuracy