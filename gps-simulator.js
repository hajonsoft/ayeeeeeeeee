// GPS Driving Simulator - Paste this into browser console
// 
// This standalone simulator can be used to test the GPS obstacle detection app
// without actually driving. It simulates realistic GPS movement with speed variations.
//
// Usage:
// 1. Open the app in your browser (http://localhost:3000)
// 2. Open browser console (F12 -> Console)
// 3. Paste this entire file content and press Enter
// 4. Run: startSimulation()
//

console.log('🧪 GPS Simulator Loaded! Run startSimulation() to begin testing.');

// Main simulation function
function startSimulation(options = {}) {
    const {
        startLat = 37.7749,     // San Francisco starting point
        startLng = -122.4194,
        direction = 90,         // 90 = East, 0 = North, 180 = South, 270 = West
        duration = 90,          // seconds
        maxSpeed = 45,          // km/h
        updateInterval = 1000   // ms
    } = options;

    let currentLat = startLat;
    let currentLng = startLng;
    let currentSpeed = 0;
    let elapsedTime = 0;
    
    console.log('🚗 Starting GPS Driving Simulation');
    console.log(`📍 Start: ${startLat.toFixed(6)}, ${startLng.toFixed(6)}`);
    console.log(`🧭 Direction: ${direction}° (0=N, 90=E, 180=S, 270=W)`);
    console.log(`⏱️ Duration: ${duration}s, Max Speed: ${maxSpeed} km/h`);
    
    const simulation = setInterval(() => {
        elapsedTime += updateInterval / 1000;
        
        // Realistic speed simulation
        if (elapsedTime < 5) {
            // Quick acceleration
            currentSpeed = (elapsedTime / 5) * maxSpeed;
        } else if (elapsedTime > duration - 8) {
            // Deceleration to stop
            const timeToStop = duration - elapsedTime;
            currentSpeed = (timeToStop / 8) * maxSpeed;
        } else {
            // Cruising with variations
            const variation = Math.sin(elapsedTime * 0.2) * 8; // ±8 km/h variation
            currentSpeed = maxSpeed + variation;
        }
        
        currentSpeed = Math.max(0, Math.min(currentSpeed, maxSpeed + 10));
        
        // Calculate movement
        const speedMPS = currentSpeed / 3.6;
        const distanceMeters = speedMPS * (updateInterval / 1000);
        
        // Update position based on direction
        const directionRad = (direction * Math.PI) / 180;
        const earthRadius = 6371000;
        
        const deltaLat = (distanceMeters * Math.cos(directionRad)) / earthRadius;
        const deltaLng = (distanceMeters * Math.sin(directionRad)) / (earthRadius * Math.cos(currentLat * Math.PI / 180));
        
        currentLat += deltaLat * (180 / Math.PI);
        currentLng += deltaLng * (180 / Math.PI);
        
        // Simulate GPS position with some accuracy variance
        const accuracyVariance = 2 + Math.random() * 3; // 2-5m accuracy
        
        const mockPosition = {
            coords: {
                latitude: currentLat + (Math.random() - 0.5) * 0.00001, // Small GPS noise
                longitude: currentLng + (Math.random() - 0.5) * 0.00001,
                accuracy: accuracyVariance,
                speed: speedMPS + (Math.random() - 0.5) * 0.5 // Small speed variance
            },
            timestamp: Date.now()
        };
        
        // Trigger the app's position handler
        if (window.React && window.React.version) {
            // Find the app instance and trigger position update
            const appElement = document.querySelector('.App');
            if (appElement && appElement._reactInternalFiber) {
                // Try to find and call handlePositionUpdate
                console.log(`🚗 ${elapsedTime.toFixed(1)}s - Speed: ${currentSpeed.toFixed(1)} km/h - ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`);
            }
        }
        
        // Manual position update (works if app exposes the function)
        if (typeof window.handlePositionUpdate === 'function') {
            window.handlePositionUpdate(mockPosition);
        }
        
        // Alternative: dispatch a custom event
        window.dispatchEvent(new CustomEvent('simulatedGPS', { detail: mockPosition }));
        
        console.log(`🚗 ${elapsedTime.toFixed(1)}s - Speed: ${currentSpeed.toFixed(1)} km/h - Pos: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`);
        
        if (elapsedTime >= duration) {
            clearInterval(simulation);
            console.log('🏁 Simulation completed!');
            console.log(`📍 Final position: ${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}`);
        }
    }, updateInterval);
    
    // Return control object
    return {
        stop: () => {
            clearInterval(simulation);
            console.log('⏹️ Simulation stopped');
        }
    };
}

// Helper function to add speed bumps along route
function addTestSpeedBumps(startLat, startLng, direction) {
    console.log('📌 Adding test speed bumps along route...');
    
    const earthRadius = 6371000;
    const directionRad = (direction * Math.PI) / 180;
    
    // Add speed bumps at various distances
    const distances = [200, 500, 800, 1200]; // meters ahead
    
    distances.forEach((distance, index) => {
        const deltaLat = (distance * Math.cos(directionRad)) / earthRadius;
        const deltaLng = (distance * Math.sin(directionRad)) / (earthRadius * Math.cos(startLat * Math.PI / 180));
        
        const bumpLat = startLat + deltaLat * (180 / Math.PI);
        const bumpLng = startLng + deltaLng * (180 / Math.PI);
        
        console.log(`📍 Speed bump ${index + 1} at ${distance}m: ${bumpLat.toFixed(6)}, ${bumpLng.toFixed(6)}`);
        
        // If app has addSpeedBumpHere function
        if (typeof window.addSpeedBumpHere === 'function') {
            setTimeout(() => window.addSpeedBumpHere(bumpLat, bumpLng), 100 * index);
        }
    });
}

// Setup test route without auto-starting simulation
function setupTestRoute(direction = 90) {
    const startLat = 37.7749;
    const startLng = -122.4194;
    
    console.log('🛣️ Setting up test route with speed bumps...');
    addTestSpeedBumps(startLat, startLng, direction);
    console.log('✅ Test route ready!');
    console.log('🚗 Now run: startSimulation() to begin driving test');
    
    return { startLat, startLng, direction };
}

// Quick test scenarios
window.startSimulation = startSimulation;
window.setupTestRoute = setupTestRoute;

window.testEastbound = () => {
    setupTestRoute(90);
    return startSimulation({ 
        direction: 90, duration: 60, maxSpeed: 40,
        startLat: 37.7749, startLng: -122.4194 
    });
};

window.testNorthbound = () => {
    setupTestRoute(0);
    return startSimulation({ 
        direction: 0, duration: 45, maxSpeed: 35,
        startLat: 37.7749, startLng: -122.4194 
    });
};

window.testHighSpeed = () => {
    setupTestRoute(90);
    return startSimulation({ 
        direction: 90, duration: 30, maxSpeed: 80,
        startLat: 37.7749, startLng: -122.4194 
    });
};

console.log('🎮 Available test commands:');
console.log('setupTestRoute() - Add speed bumps along route (manual control)');
console.log('startSimulation(options) - Start GPS simulation (manual control)');
console.log('');
console.log('testEastbound() - Complete east test (auto-start)');
console.log('testNorthbound() - Complete north test (auto-start)');
console.log('testHighSpeed() - Complete high-speed test (auto-start)');
console.log('');
console.log('💡 Manual: setupTestRoute() then startSimulation()');
console.log('💡 Auto: testEastbound()');