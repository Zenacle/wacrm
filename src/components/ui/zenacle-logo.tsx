import React from "react";
import Image from "next/image";

interface ZenacleLogoProps {
  className?: string;
  showText?: boolean;
  textColor?: string; // Kept for compatibility, though the logo asset has fixed white colors
  iconSize?: number;
  variant?: "full" | "icon" | "sidebar" | "navbar" | "login" | "horizontal" | "vertical";
}

export function ZenacleLogo({
  className = "",
  showText = true,
  iconSize = 32,
  variant = "horizontal",
}: ZenacleLogoProps) {
  // Determine if we should show only the icon based on variant or showText
  const isIconOnly = variant === "icon" || !showText;

  if (isIconOnly) {
    // The Z logo is roughly square on the left of the 304x123 image.
    // We crop it by placing the image in a container with a 1:1 aspect ratio,
    // using object-cover and object-left to hide the text on the right.
    const width = Math.round(iconSize * (304 / 123));
    return (
      <div 
        className={`overflow-hidden shrink-0 select-none ${className}`} 
        style={{ width: iconSize, height: iconSize }}
      >
        <Image
          src="/assets/branding/zenacle-logo.png"
          alt="Zenacle Solutions Icon"
          width={width}
          height={iconSize}
          className="max-w-none object-cover object-left"
          priority
        />
      </div>
    );
  }

  // Adjust dimensions based on the variant while maintaining the 304:123 aspect ratio
  let width = 148;
  let height = 60;

  if (variant === "login" || variant === "vertical") {
    width = 220;
    height = 89;
  } else if (variant === "sidebar") {
    width = 132;
    height = 53;
  } else if (variant === "navbar") {
    width = 120;
    height = 49;
  } else {
    // Custom width based on iconSize if provided
    height = iconSize;
    width = Math.round(iconSize * (304 / 123));
  }

  return (
    <div className={`relative shrink-0 select-none ${className}`} style={{ width, height }}>
      <Image
        src="/assets/branding/zenacle-logo.png"
        alt="Zenacle Solutions Logo"
        width={width}
        height={height}
        className="object-contain"
        priority
      />
    </div>
  );
}
