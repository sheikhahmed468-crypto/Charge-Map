// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: ({ children }) => <div>{children}</div>,
  Popup: ({ children }) => <div>{children}</div>,
  Polyline: () => null,
}))

vi.mock('leaflet', () => ({
  default: {
    divIcon: () => ({}),
  },
}))

import App from './App'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete navigator.geolocation
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
})

describe('Charge Map page', () => {
  it('renders the main product sections', () => {
    render(<App />)

    expect(screen.getByText('Find every charge.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Find your next charge' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Know your charge time before you arrive.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Is this location ready for an EV station?' })).toBeTruthy()
  })

  it('opens the mobile navigation and closes it after a selection', async () => {
    const user = userEvent.setup()
    render(<App />)

    const menuButton = screen.getByRole('button', { name: 'Toggle menu' })
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')

    await user.click(menuButton)
    expect(menuButton.getAttribute('aria-expanded')).toBe('true')

    await user.click(screen.getByRole('link', { name: 'Journey planner' }))
    expect(menuButton.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters chargers by AC and DC type', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'AC' }))
    const stationList = screen.getByTestId('station-list')
    expect(within(stationList).getByText('Dolmen Mall')).toBeTruthy()
    expect(within(stationList).queryByText('Emporium Mall')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'DC' }))
    expect(within(stationList).getByText('Emporium Mall')).toBeTruthy()
  })

  it('shows an honest empty state when a charger search has no matches', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByRole('textbox', { name: 'Search city or charger' }), 'Atlantis')

    expect(screen.getByText('No stations match that search. Try another city or charger name.')).toBeTruthy()
  })

  it('shows available station details and keeps duplicate station names distinct', async () => {
    const stations = [
      {
        id: 1,
        name: 'Test Charge',
        city: 'Karachi',
        lat: 24.86,
        lng: 67,
        type: 'DC',
        powerKW: 60,
        price: 45,
        address: 'Clifton',
        connectors: ['CCS2'],
        phone: '0300 1234567',
        amenities: ['Parking'],
      },
      {
        id: 2,
        name: 'Test Charge',
        city: 'Lahore',
        lat: 31.52,
        lng: 74.36,
        type: 'AC',
        powerKW: 22,
        connectors: ['Type 2'],
      },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('/chargers.json')
        ? { ok: true, json: async () => ({ chargers: stations }) }
        : { ok: false }
    )))
    render(<App />)

    const stationList = screen.getByTestId('station-list')
    expect(await within(stationList).findAllByRole('button', { name: /Test Charge/ })).toHaveLength(2)
    expect(await screen.findByText('Connectors: CCS2')).toBeTruthy()
    expect(screen.getByText('Amenities: Parking')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Call 0300 1234567' }).getAttribute('href')).toBe('tel:03001234567')
    expect(screen.getByRole('link', { name: 'Directions' }).getAttribute('href')).toContain('google.com/maps/dir')
  })

  it('plans a journey in the planner instead of navigating to the charger map', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('router.project-osrm.org')) {
        return {
          ok: true,
          json: async () => ({
            routes: [{
              distance: 400000,
              duration: 18000,
              geometry: {
                coordinates: [
                  [74.3587, 31.5204],
                  [73.8, 32],
                  [73.4, 32.7],
                  [73.0479, 33.6844],
                ],
              },
            }],
          }),
        }
      }
      return { ok: false }
    }))
    render(<App />)

    await user.click(screen.getByRole('button', { name: /Plan my journey/ }))

    const routeResults = await screen.findByTestId('route-results')
    expect(within(routeResults).getByText('400 km')).toBeTruthy()
    expect(screen.getByText('Lahore → Islamabad')).toBeTruthy()
  })

  it('uses the browser current location as the trip origin and calculates distance', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('router.project-osrm.org')) {
        return {
          ok: true,
          json: async () => ({
            routes: [{
              distance: 160000,
              duration: 7200,
              geometry: { coordinates: [[67, 24.86], [70, 28], [73.0479, 33.6844]] },
            }],
          }),
        }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: 24.86, longitude: 67 } }),
      },
    })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Use my current location' }))

    expect(await screen.findByText('Current location → Islamabad')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/67,24.86;73.0479,33.6844?'))).toBe(true)
    expect(within(await screen.findByTestId('route-results')).getByText('160 km')).toBeTruthy()
  })

  it('updates range conversion', async () => {
    const user = userEvent.setup()
    render(<App />)

    const rangeInput = screen.getByRole('spinbutton', { name: 'Quoted range' })
    await user.clear(rangeInput)
    await user.type(rangeInput, '500')

    expect(screen.getByText('430 km')).toBeTruthy()
  })

  it('calculates energy, time and price from the selected battery settings', () => {
    render(<App />)

    expect(screen.getByText('41.3 kWh')).toBeTruthy()
    expect(screen.getByText('19 min')).toBeTruthy()
    expect(screen.getByText('PKR 4,950')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Target charge level'), { target: { value: '20' } })

    expect(screen.getByText('0.0 kWh')).toBeTruthy()
    expect(screen.getByText('0 min')).toBeTruthy()
    expect(screen.getByText('PKR 0')).toBeTruthy()
  })

  it('submits a charger report', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByPlaceholderText('e.g. Mall or petrol station'), 'Test Station')
    await user.type(screen.getByPlaceholderText('City'), 'Lahore')
    await user.click(screen.getByRole('button', { name: 'Preview report' }))

    expect(screen.getByRole('button', { name: 'Report preview complete' })).toBeTruthy()
    expect(screen.getByText(/This demo does not send submissions to a server yet/)).toBeTruthy()
  })

  it('shows the API score and factor-by-factor explanation', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        score: 72,
        summary: 'Promising location with incomplete adoption data.',
        factors: [
          { factor: 'Nearby charging stations', value: '2 nearby', source: 'Bundled dataset', impact: 'neutral', explanation: 'Nearby coverage is present.' },
          { factor: 'Traffic', value: 'High', source: 'User-provided estimate', impact: 'positive', explanation: 'High traffic can improve visibility.' },
          { factor: 'Population density', value: 'Data unavailable', source: 'No data provided', impact: 'unknown', explanation: 'Population data is unavailable.' },
          { factor: 'EV adoption', value: 'Data unavailable', source: 'No data provided', impact: 'unknown', explanation: 'Adoption data is unavailable.' },
          { factor: 'Parking availability', value: 'Available', source: 'User-provided estimate', impact: 'positive', explanation: 'Parking is reported available.' },
          { factor: 'Grid access', value: 'Adequate', source: 'User-provided estimate', impact: 'positive', explanation: 'Grid access is reported adequate.' },
        ],
        limitations: 'AI-generated decision-support score, not a calibrated probability.',
      }),
    })))
    render(<App />)

    await user.type(screen.getByPlaceholderText('Street, area or city'), 'Blue Area, Islamabad')
    await user.click(screen.getByRole('button', { name: 'Assess site suitability' }))
    expect(await screen.findByText('72%')).toBeTruthy()
    const factors = screen.getByTestId('assessment-factors')
    expect(within(factors).getByText('EV adoption')).toBeTruthy()
    expect(within(factors).getByText('Adoption data is unavailable.')).toBeTruthy()
  })

  it('displays the backend configuration error instead of showing a fake score', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ detail: 'Local AI is not running. Start Ollama and make sure the selected model is installed.' }),
    })))
    render(<App />)

    await user.type(screen.getByPlaceholderText('Street, area or city'), 'Lahore')
    await user.click(screen.getByRole('button', { name: 'Assess site suitability' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Start Ollama')
    expect(screen.queryByText('AI-estimated suitability score')).toBeNull()
  })
})
