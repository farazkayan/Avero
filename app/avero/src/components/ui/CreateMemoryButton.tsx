import FlowButton from "./flow-button";
import { memoryCreatePath } from "../../constants/routes";

type CreateMemoryButtonProps = {
  /** The Space ID for building the create memory route */
  spaceId: string;
  /** Additional className for spacing/layout */
  className?: string;
};

/**
 * "Create Memory" button matching the "Create a Space" FlowButton styling and interaction.
 */
export default function CreateMemoryButton({ spaceId, className = "" }: CreateMemoryButtonProps) {
  return (
    <FlowButton
      to={memoryCreatePath(spaceId)}
      text="Create Memory"
      className={className}
    />
  );
}