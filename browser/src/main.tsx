import { render } from 'solid-js/web'

import { App } from './App.tsx'
import './styles.css'

const root = document.getElementById('root')

if (root === null) {
  console.error('Agentopoly browser projection could not find its root element')
} else {
  render(() => <App />, root)
}
