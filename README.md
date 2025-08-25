# Geospatial Data Viewer

A modern web application for viewing geospatial data with WMS layer support, Areas of Interest (AOI) management, and interactive mapping capabilities.

## Features

### Frontend (Next.js + Leaflet)
- **Interactive Map Viewer**: Built with Leaflet.js for smooth map interactions
- **WMS Layer Support**: Load and display multiple WMS layers from GeoServer
- **Layer Management**: Toggle layers on/off with opacity controls
- **Feature Information**: Click on map to get detailed feature attributes via WMS GetFeatureInfo
- **AOI Drawing**: Draw and save Areas of Interest as GeoJSON polygons
- **Responsive Design**: Modern UI with Tailwind CSS

### Backend (Node.js + Express + MongoDB)
- **RESTful API**: Full CRUD operations for AOI management
- **GeoJSON Support**: Native MongoDB geospatial queries and indexing
- **Authentication**: JWT-based authentication with Clerk
- **Data Validation**: Robust input validation with Zod schemas
- **Caching**: Server-side caching for WMS requests to improve performance

### Security Features
- **JWT Authentication**: Secure user authentication and authorization
- **Input Validation**: Comprehensive GeoJSON validation to prevent injection attacks
- **CORS Protection**: Proper cross-origin resource sharing configuration

### Performance Optimizations
- **GeoJSON Simplification**: Automatic polygon simplification for large geometries
- **WMS Caching**: Intelligent caching system to reduce repeated WMS requests
- **Lazy Loading**: Map features loaded only when visible

## Prerequisites

- Node.js 18+ 
- MongoDB 5+
- Clerk account for authentication

## Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd geospatial-viewer
```

### 2. Backend Setup
```bash
cd server
npm install
```

Create a `.env` file based on `env.example`:
```bash
cp env.example .env
```

Edit `.env` with your configuration:
```env
MONGO_URI=mongodb://localhost:27017/geospatial_viewer
CLERK_SECRET_KEY=your_clerk_secret_key_here
PORT=5001
CLIENT_ORIGIN=http://localhost:3000
```

### 3. Frontend Setup
```bash
cd ../client
npm install
```

Create a `.env.local` file based on `env.example`:
```bash
cp env.example .env.local
```

Edit `.env.local` with your configuration:
```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key_here
NEXT_PUBLIC_API_URL=http://localhost:5001
```

### 4. Start the Application

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd client
npm run dev
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5001

## API Endpoints

### Authentication Required Endpoints

#### AOI Management
- `POST /aoi` - Create new Area of Interest
- `GET /aoi` - Get all AOIs for authenticated user
- `GET /aoi/:id` - Get specific AOI by ID
- `PUT /aoi/:id` - Update existing AOI
- `DELETE /aoi/:id` - Delete AOI
- `GET /aoi/bbox` - Get AOIs within bounding box

#### WMS Services
- `GET /wms/feature-info` - Get feature information from WMS layers

### Public Endpoints
- `GET /health` - Server health check
- `GET /debug/auth` - Authentication debugging

## WMS Layer Configuration

The application is pre-configured with the following WMS layers:
1. **Tripura Boundary**: `tripura:tripura_gpvc_boundary`
2. **Tripura Drainage**: `tripura:tripura_drainage`

WMS Server: `https://geoserver01.haketech.com/geoserver/wms`

## Usage

### 1. Authentication
- Sign up or sign in using the Clerk authentication system
- All AOI operations require authentication

### 2. Map Navigation
- Use mouse to pan and zoom the map
- Toggle WMS layers using the layer control panel
- Adjust layer opacity using the sliders

### 3. Feature Information
- Click on the map to get feature information
- Ensure at least one WMS layer is visible
- Feature data is fetched via WMS GetFeatureInfo

### 4. Creating AOIs
- Use the drawing tools to create polygons
- Provide a name and description when prompted
- AOIs are automatically saved and displayed

### 5. Managing AOIs
- View all saved AOIs on the map
- Click on AOIs to see details
- Edit or delete AOIs through the API

## Development

### Project Structure
```
geospatial-viewer/
├── client/                 # Next.js frontend
│   ├── app/               # App router components
│   ├── components/        # React components
│   └── public/            # Static assets
├── server/                # Express.js backend
│   ├── models/            # MongoDB models
│   ├── routes/            # API routes
│   └── middleware/        # Express middleware
└── README.md
```

### Key Technologies
- **Frontend**: Next.js 15, React 19, Leaflet.js, Tailwind CSS
- **Backend**: Node.js, Express.js, MongoDB, Mongoose
- **Authentication**: Clerk
- **Validation**: Zod
- **Maps**: Leaflet with WMS support

### Development Commands

**Backend:**
```bash
npm run dev      # Start development server
npm run lint     # Run ESLint
npm start        # Start production server
```

**Frontend:**
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Environment Variables

### Backend (.env)
- `MONGO_URI`: MongoDB connection string
- `CLERK_SECRET_KEY`: Clerk secret key for authentication
- `PORT`: Server port (default: 5001)
- `CLIENT_ORIGIN`: Allowed CORS origin

### Frontend (.env.local)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk publishable key
- `NEXT_PUBLIC_API_URL`: Backend API URL

## Troubleshooting

### Common Issues

1. **Map not loading**
   - Check browser console for errors
   - Ensure Leaflet CSS is properly imported
   - Verify internet connection for tile loading

2. **Authentication errors**
   - Verify Clerk configuration
   - Check environment variables
   - Ensure JWT tokens are valid

3. **WMS layers not displaying**
   - Check WMS server availability
   - Verify layer names and parameters
   - Check browser network tab for failed requests

4. **MongoDB connection issues**
   - Verify MongoDB is running
   - Check connection string format
   - Ensure database exists

### Debug Endpoints
- `/health` - Check server status
- `/debug/auth` - Debug authentication headers

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.

## Support

For support and questions:
- Check the troubleshooting section
- Review server and client logs
- Open an issue on GitHub
