import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  onValueChange,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props & { onValueChange?: (value: number[]) => void }) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none items-center select-none py-2", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      onValueChange={onValueChange}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none h-6">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-white/10 select-none h-1.5 w-full cursor-pointer"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-gradient-to-r from-orange-500 to-red-500 absolute h-full select-none"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className="relative block size-5 shrink-0 rounded-full border-2 border-white bg-orange-600 shadow-[0_0_10px_rgba(249,115,22,0.5)] transition-transform active:scale-125 focus:outline-none select-none cursor-grab active:cursor-grabbing z-20"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
