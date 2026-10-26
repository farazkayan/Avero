import { FlowButton } from './flow-button';
import { ThemeSwitch } from './theme-switch-button';

export function FlowButtonDemo() {
  return (
    <div className="flex min-h-[200px] items-center justify-center bg-canvas p-6 rounded-xl border border-outline-variant/30">
      <FlowButton text="Flow Button" />
    </div>
  );
}

export function ThemeSwitchDemo() {
  return (
    <div className="flex justify-center items-center py-8">
      <ThemeSwitch />
    </div>
  );
}

export default { FlowButtonDemo, ThemeSwitchDemo };
