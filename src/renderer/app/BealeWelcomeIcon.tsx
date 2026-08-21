import type { JSX } from 'react';
import bealeAppIcon from '../../../resources/app-icon.png';

export function BealeWelcomeIcon(): JSX.Element {
  return <img className="new-research-welcome-icon" src={bealeAppIcon} alt="Beale" />;
}
