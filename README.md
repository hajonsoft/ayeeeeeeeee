# GPS Obstacle Detection App

A React-based mobile web application that tracks your location in real-time and detects potential speed bumps while driving. The app displays GPS coordinates, speed, direction, and provides a navigation interface similar to Google Maps.

## Features

### 🗺️ Real-time GPS Tracking
- Live latitude and longitude display (6 decimal precision)
- Speed calculation in km/h
- Direction tracking with compass bearing (0-360°)
- GPS accuracy indicator

### 🧭 Navigation Interface
- Rotating directional arrow (like Google Maps)
- Compass direction display (N, NE, E, SE, S, SW, W, NW)
- Real-time direction updates based on movement

### 🚧 Speed Bump Detection
- Automatic detection based on speed patterns
- Records exact GPS coordinates of obstacles
- Stores safe passing speed and direction
- Directional awareness (speed bumps may exist in one direction only)

### 📊 Data Management
- Historical speed bump records
- Scanned road segments tracking
- Persistent storage of obstacle locations
- Timestamp tracking for all records

## How It Works

### Mathematical Calculations

The app uses several mathematical formulas to calculate movement data:

1. **Distance Calculation**: Haversine formula for great-circle distance
2. **Speed Calculation**: Distance over time, converted to km/h
3. **Direction Calculation**: Forward azimuth bearing between GPS points
4. **Speed Bump Detection**: Pattern recognition based on speed thresholds

For detailed mathematical explanations, see [GPS_FORMULAS_EXPLAINED.md](./GPS_FORMULAS_EXPLAINED.md)

### Speed Bump Detection Algorithm

- Monitors rolling average of last 3 speed readings
- Triggers when average speed < 20 km/h AND current speed < 15 km/h
- Accounts for directional travel (obstacles may be one-way)
- Records safe passing speed based on recent maximum speed

## Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd obstacles
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

4. **Access the app**
   - Open `http://localhost:3000` in your browser
   - **Important**: For GPS to work, you need HTTPS in production
   - For testing, use Chrome with location permissions enabled

## Usage Instructions

### Getting Started
1. Open the app on your mobile device or desktop
2. Grant location permissions when prompted
3. Wait for GPS lock (green indicator)
4. Begin driving to see real-time data

### Recording Speed Bumps
1. Drive normally - the app monitors your speed continuously
2. When you slow down significantly (for a speed bump), an alert will appear
3. Tap "Mark Speed Bump" to record the obstacle location
4. The app saves GPS coordinates, direction, and safe speed

### Viewing Recorded Data
- **Speed Bumps Panel**: Shows last 5 recorded obstacles
- **Scanned Roads Panel**: Tracks road segments you've monitored
- Each record includes precise coordinates, direction, and timestamp

## Technical Details

### GPS Requirements
- High accuracy GPS enabled
- HTTPS connection (required for geolocation API)
- Location permissions granted
- Stable GPS signal (accuracy < 10 meters recommended)

### Browser Compatibility
- Chrome (recommended)
- Safari (iOS/macOS)
- Firefox
- Edge

### Data Structure

**Speed Bump Record:**
```javascript
{
  id: 1699372800000,
  latitude: 40.748817,
  longitude: -73.985428,
  direction: 45.6,
  safeSpeed: 18.5,
  timestamp: "2023-11-07T15:20:00.000Z",
  compassDirection: "NE"
}
```

## Future Development Plans

### Phase 1: Database Integration
- PostgreSQL/MongoDB backend
- User authentication
- Cloud storage for speed bump data

### Phase 2: Advanced Features
- Predictive warnings for upcoming speed bumps
- Route planning with obstacle avoidance
- Community verification of speed bump reports

### Phase 3: AI Enhancement
- Machine learning for better detection accuracy
- Pattern recognition for different obstacle types
- False positive reduction algorithms

### Phase 4: Social Features
- Crowdsourced obstacle reporting
- User ratings and verification system
- Real-time obstacle status updates

## API Integration Plans

Future versions will include:
- **Google Maps Integration**: Visual map display
- **OpenStreetMap**: Open-source mapping alternative
- **Government Databases**: Official road hazard data
- **Traffic APIs**: Real-time traffic integration

## Privacy & Security

- GPS data processed locally on device
- No location tracking when app is closed
- Optional data sharing for community features
- User controls for data retention

## Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

For questions, issues, or feature requests:
- Create an issue on GitHub
- Email: [your-email@example.com]
- Documentation: See [GPS_FORMULAS_EXPLAINED.md](./GPS_FORMULAS_EXPLAINED.md)

---

**Note**: This app requires location permissions and works best with high-accuracy GPS. For production use, deploy over HTTPS to enable geolocation features.
