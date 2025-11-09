# GPS Obstacle Detection App Testing Guide

## Testing Without Driving 🚗

This app includes comprehensive testing tools that simulate GPS movement without requiring actual driving. There are two ways to test the application:

## Method 1: Built-in Console Commands (Recommended)

The app automatically exposes testing functions in development mode. 

### Steps:
1. Start the development server: `npm start`
2. Open http://localhost:3000 in your browser
3. Open browser console (F12 → Console tab)
4. Look for the testing commands that are automatically logged

### Available Commands:

```javascript
// Setup test route with speed bumps (doesn't auto-start)
runQuickTest()

// Start GPS simulation manually
startDrivingSimulation({
  startLat: 37.7749,    // Starting latitude
  startLng: -122.4194,  // Starting longitude  
  direction: 90,        // Direction: 0=North, 90=East, 180=South, 270=West
  duration: 60,         // Simulation duration in seconds
  maxSpeed: 50,         // Maximum speed in km/h
  updateInterval: 1000  // GPS update interval in milliseconds
})

// Add speed bumps manually
addSpeedBumpHere(37.7750, -122.4180)

// Create multiple speed bumps along a route
createTestRoute(startLat, startLng, endLat, endLng, bumpCount)

// Stop simulation anytime
window.drivingSimulation.stop()
```

### Example Test Scenarios:

```javascript
// Test 1: Manual setup and start (recommended)
runQuickTest()  // Creates speed bumps
startDrivingSimulation()  // Start driving when you're ready

// Test 2: Custom slow city driving
runQuickTest()  // Setup route
startDrivingSimulation({ 
  direction: 0,     // North
  duration: 45,     // 45 seconds
  maxSpeed: 25,     // 25 km/h city speed
  updateInterval: 500  // Faster updates
})

// Test 3: Highway driving
runQuickTest()  // Setup route  
startDrivingSimulation({ 
  direction: 90,    // East
  duration: 30,     // 30 seconds
  maxSpeed: 80,     // 80 km/h highway speed
  updateInterval: 1000
})

// Test 4: Stop simulation early
window.drivingSimulation.stop()
```

## Method 2: Standalone Console Simulator

If you prefer a completely independent simulator:

### Steps:
1. Open the file `gps-simulator.js` 
2. Copy the entire content
3. Paste it into the browser console
4. Run test commands

### Available Commands:
```javascript
setupTestRoute()   // Add speed bumps (manual control)
startSimulation()  // Start GPS simulation (manual control)

// Complete auto-tests (setup + start automatically)
testEastbound()    // Drive east at 40 km/h
testNorthbound()   // Drive north at 35 km/h  
testHighSpeed()    // Drive east at 80 km/h
```

## What to Observe During Testing 🧪

### 1. **Speed Calculation**
- Watch the speed display update in real-time
- Should show acceleration (0 → max speed)
- Should show cruising with slight variations
- Should show deceleration at the end
- Speed should never show 0 while "driving"

### 2. **Speed Bump Detection**
- Speed bumps are automatically added along the test route
- Watch for speed bumps to appear as "ahead" when approaching
- Observe the distance countdown (300m → 200m → 100m → etc.)
- Speed bumps should change to "behind" after passing

### 3. **Direction Logic**
- Only speed bumps in your driving direction should trigger alerts
- "Ahead" vs "Behind" should be accurate based on movement direction

### 4. **Extreme Alert System**
- **Audio**: Should hear loud beeping when within 150m of speed bump ahead
- **Visual**: Screen should flash red/orange/yellow when very close
- **Vibration**: Should feel device vibrate (on mobile) 
- **Speed Bump Cards**: Should show dramatic colors and animations

### 5. **Display Limits**
- Should only show maximum 1 speed bump ahead
- Should only show maximum 1 speed bump behind
- Clean, uncluttered display

### 6. **Fullscreen Mode**
- Test fullscreen button on both desktop and mobile
- Should work on actual mobile devices (not just dev tools)

## Testing Classification 📋

This is an **Integration Test** because it tests:
- GPS position handling
- Speed calculation algorithms  
- Direction detection logic
- Database filtering and queries
- UI updates and animations
- Alert system triggering
- Audio/vibration functionality

It simulates the complete user journey without requiring actual GPS movement.

## Debugging Tips 🔍

1. **Check Console Logs**: The simulator provides detailed logging
2. **Watch Network Tab**: Monitor Firebase queries and responses
3. **Test Different Scenarios**: Try various speeds, directions, and durations
4. **Mobile Testing**: Test on actual mobile devices for fullscreen and vibration
5. **Audio Issues**: Check browser audio permissions and volume settings

## Expected Test Results ✅

- **Speed**: Smooth acceleration, cruising variations, deceleration
- **Detection**: Accurate ahead/behind classification
- **Alerts**: Audio + visual + vibration when close to speed bumps
- **Display**: Clean display with only closest relevant speed bumps
- **Performance**: Smooth updates without lag or glitches

## Quick Test Checklist 📝

```
□ Run runQuickTest() to setup route with speed bumps
□ Run startDrivingSimulation() when ready to start
□ Verify speed shows realistic values (not 0)
□ Confirm speed bumps appear ahead first
□ Listen for audio alerts when approaching speed bumps
□ Watch for visual danger mode (red flashing)
□ Check speed bumps change to "behind" after passing
□ Test fullscreen mode works
□ Verify only 1 bump ahead + 1 behind shown
□ Test manual stop with window.drivingSimulation.stop()
```

Happy testing! 🚗⚠️