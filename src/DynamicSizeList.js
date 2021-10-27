import React, { createElement } from "react";
import memoizeOne from 'memoize-one';

import { VariableSizeList } from "react-window";

// override since not exposed in api
const defaultItemKey = (index, data) => index;
const shouldResetStyleCacheOnItemSizeChange = false;

//paste override since not exposed in api
const getItemMetadata = (
  props,
  index,
  instanceProps
) => {
  const { itemMetadataMap, estimatedItemSize } = instanceProps;

  if (!itemMetadataMap[index]) {
    const prevItem = itemMetadataMap[index - 1];
    const nextItem = itemMetadataMap[index + 1];
    const offset = prevItem ? prevItem.offset + prevItem.size :
      (nextItem ? nextItem.offset - estimatedItemSize : 0);
    itemMetadataMap[index] = {
      offset: offset,
      size: estimatedItemSize,
      measured: false
    }
  }

  return itemMetadataMap[index];
};

const getItemOffset = (
  props,
  index,
  instanceProps
) => getItemMetadata(props, index, instanceProps).offset;

const getItemSize = (
  props,
  index,
  instanceProps
) => {
  const { estimatedItemSize } = instanceProps;
  const item = getItemMetadata(props, index, instanceProps);
  const savedSize = item ? item.size : -1;
  return savedSize >= 0 ? savedSize : estimatedItemSize;

}

const getStopIndexForStartIndex = (
  props,
  startIndex,
  instanceProps
) => {
  const { direction, height, itemCount, layout, width } = props;

  // TODO Deprecate direction "horizontal"
  const isHorizontal = direction === 'horizontal' || layout === 'horizontal';
  const size = (((isHorizontal ? width : height)));
  const itemMetadata = getItemMetadata(props, startIndex, instanceProps);
  const maxOffset = itemMetadata.offset + size;

  let offset = itemMetadata.offset + itemMetadata.size;
  let stopIndex = startIndex;
  while (stopIndex < itemCount - 1 && offset < maxOffset) {
    stopIndex++;
    offset += getItemMetadata(props, stopIndex, instanceProps).size;
  }
  return stopIndex;
}

class IndexedListItem extends React.Component {
  //required props: index, style, onSetSize, childCreationCallback
  constructor(props) {
    super(props);
    this.width = 0;
    this.height = 0;
    this.childRef = React.createRef();
    this.resizeObserver = null;
  }

  componentDidMount() {
    if (this.childRef.current) {
      const node = this.childRef.current;
      const onSetSize = this.props.onSetSize;
      if (node) {
        if (onSetSize) {
          onSetSize(this.props.index, node);
        }
      }
      try {
        this.resizeObserver = new ResizeObserver(() => {
          if (
            onSetSize &&
            ((node.offsetHeight > 0 &&
              node.offsetHeight !== this.height) ||
              (node.offsetWidth > 0 && node.offsetWidth !== this.width))
          ) {
            this.height = node.offsetHeight;
            this.width = node.offsetWidth;
            onSetSize(this.props.index, node);
          }
        });
        this.resizeObserver.observe(node);
      } catch (e) {
        //console.log("ResizeObserver API not available");
      }
    }
  }
  componentWillUnmount() {
    if (this.resizeObserver) {
      this.resizeObserver.unobserve(this.childRef.current);
    }
  }

  render() {
    return createElement('span', { style: this.props.style },
      this.props.childCreationCallback(this.props.index, this.childRef));
  }
}

export default class DynamicSizeList extends VariableSizeList {
  // props: componentRef, scrollFromEnd, [other VariableSizeList props]
  // will override ref and itemSize props.

  constructor(props) {
    super(props);
    this.firstScrollDone = false;
    this.leastItemOffset = 0;
    this._instanceProps.estimatedItemSize = 50;
    this.measuredItemsCount = 0;
    this.totalMeasuredSize = 0;
    this.lastRangeRendered = null;
    //increment it with setState to request an update. Especially usefull after children change sizes.
    this.state.stateCounter = 0;

  }

  requestUpdate() {
    this.setState(prevState => ({ stateCounter: prevState.stateCounter + 1 }));
  }

  _withinOverscanRange(scrollOffset, startIndex, endIndex, props, instanceProps) {
    if (endIndex <= startIndex) return false;
    let startOffset = getItemOffset(props, startIndex, instanceProps);
    let endOffset = startOffset;
    for (let i = startIndex; i < endIndex + 1 && i < props.itemCount; i++) {
      endOffset += getItemSize(props, i, instanceProps);
    }
    return scrollOffset > startOffset && scrollOffset < endOffset;
  }

  _createFirstRangeToRender() {
    const { itemCount, overscanCount, height, width, direction, layout } = this.props;
    const { scrollOffset } = this.state;
    const isHorizontal = direction === "horizontal" || layout === "horizontal";
    let estimatedIndex = Math.floor(scrollOffset * itemCount / this.getEstimatedTotalSize());
    estimatedIndex = estimatedIndex < 0 ? 0 : estimatedIndex;
    if (!this.lastRangeRendered) {
      // create a new range at the begining
      const startIndex = estimatedIndex;
      const windowSize = isHorizontal ? width : height;
      const startOffset = getItemOffset(this.props, startIndex, this._instanceProps);
      const maxOffset = startOffset + windowSize;
      let offset = startOffset;
      let stopIndex = startIndex;
      while (stopIndex < itemCount && offset < maxOffset) {
        stopIndex++;
        offset += getItemSize(this.props, stopIndex, this._instanceProps);
      }

      // overscan by at least one
      const adjustedOverscanCount = overscanCount > 0 ? overscanCount : 1;
      const overscanStart = startIndex - adjustedOverscanCount > 0 ? startIndex - adjustedOverscanCount : 0;
      const overscanStop = stopIndex + adjustedOverscanCount < itemCount ? stopIndex + adjustedOverscanCount : itemCount - 1;
      this.lastRangeRendered = [overscanStart, overscanStop, startIndex, stopIndex];
    }
    return this.lastRangeRendered;
  }

  _getRangeToRender(unadjustedScrollOffset) {
    // adjust offset
    const scrollOffset = unadjustedScrollOffset - Math.abs(this.leastItemOffset);
    const { itemCount, overscanCount } = this.props;
    const scrollSize = this.getEstimatedTotalSize();
    let estimatedIndex = Math.floor(scrollOffset * (itemCount - 1) / scrollSize);
    estimatedIndex = estimatedIndex < 0 ? 0 : estimatedIndex;
    estimatedIndex = estimatedIndex >= itemCount ? itemCount - 1 : estimatedIndex;
    if (!this.lastRangeRendered) {
      // create a new range at the beginning
      this._createFirstRangeToRender();
    }
    const [overscanStartIndex, overScanStopIndex] = this.lastRangeRendered;
    let nearestIndexInOverscan = overscanStartIndex;
    const useEstimate = !this._withinOverscanRange(scrollOffset, overscanStartIndex, overScanStopIndex, this.props, this._instanceProps);
    if (!useEstimate) {
      const firstOffset = getItemOffset(this.props, overscanStartIndex, this._instanceProps);
      let leastDistance = Math.abs(firstOffset - scrollOffset);
      let nextItemOffset = firstOffset;
      for (let i = overscanStartIndex + 1; i <= overScanStopIndex; i++) {
        nextItemOffset += getItemMetadata(this.props, i, this._instanceProps).size;
        const difference = Math.abs(nextItemOffset - scrollOffset);
        if (difference < leastDistance) {
          nearestIndexInOverscan = i;
          leastDistance = difference;
        }
      }
    }
    let startIndex = useEstimate ? estimatedIndex : nearestIndexInOverscan;
    const stopIndex = getStopIndexForStartIndex(this.props, startIndex, this._instanceProps);
    // Overscan by one item in each direction so that tab/focus works.
    // If there isn't at least one extra item, tab loops back around.
    const adjustedOverscanCount = overscanCount > 0 ? overscanCount : 1;
    const overscanStart = startIndex - adjustedOverscanCount > 0 ? startIndex - adjustedOverscanCount : 0;
    const overscanStop = stopIndex + adjustedOverscanCount < itemCount ? stopIndex + adjustedOverscanCount : itemCount - 1;
    // bring estimate to visible range
    if (useEstimate) {
      // anchor at startIndex after estimation
      getItemMetadata(this.props, startIndex, this._instanceProps).offset = scrollOffset;
      // push back items before startIndex
      this.fixOverlaps(itemCount, overscanStart, startIndex, true);
      // push forward items after startIndex
      this.fixOverlaps(itemCount, startIndex, overscanStop, false);
    }
    this.lastRangeRendered = [
      overscanStart,
      overscanStop,
      startIndex,
      stopIndex,
      useEstimate
    ];
    return this.lastRangeRendered;
  }
  // TODO. Dont know if this works. I want to memoize the rangetorender function.
  _getRangeToRender = memoizeOne(this._getRangeToRender)

  componentDidMount() {
    super.componentDidMount();
    // give parent the list ref
    if (this.props.componentRef) this.props.componentRef.current = this;
  }

  componentDidUpdate() {
    super.componentDidUpdate();

    const { isScrolling } = this.state;
    const { itemCount, scrollFromEnd } = this.props;
    // scroll to end on first items population if props say we should start from end
    if (
      !this.firstScrollDone &&
      itemCount > 0 &&
      this.measuredItemsCount > 0 &&
      scrollFromEnd
    ) {
      if (!isScrolling) {
        this.scrollTo(this.getEstimatedTotalSize());
        this.firstScrollDone = true;
      }
    }
  }

  getEstimatedTotalSize() {
    const unmeasuredItemsCount = this.props.itemCount - this.measuredItemsCount;
    const unmeasuredSize = unmeasuredItemsCount * this._instanceProps.estimatedItemSize;
    const measuredSize = this.totalMeasuredSize;
    const estimatedSize = measuredSize + unmeasuredSize;
    return estimatedSize;
  }

  setSize(index, node) {
    const { direction, layout, itemCount } = this.props;
    if (index < 0 || index >= itemCount) return;
    const fromEnd = this.state.scrollDirection === 'backward';
    const isHorizontal = direction === "horizontal" || layout === "horizontal";
    const newSize = isHorizontal ? node.offsetWidth : node.offsetHeight;

    const currentItemData = getItemMetadata(this.props, index, this._instanceProps);
    if (newSize >= 0 && currentItemData.size !== newSize) {
      const oldSize = currentItemData.size;
      currentItemData.size = newSize;
      //fix overlaps while anchored at index
      const [overscanStart, overscanStop] = this._getRangeToRender(this.state.scrollOffset);
      this.fixOverlaps(itemCount, index, overscanStop, fromEnd);
      this.fixOverlaps(itemCount, overscanStart, index, !fromEnd);
      // update estimated total size
      if (!currentItemData.measured) {
        currentItemData.measured = true;
        this.measuredItemsCount += 1;
        this.totalMeasuredSize = this.totalMeasuredSize + newSize;
      } else {
        this.totalMeasuredSize = this.totalMeasuredSize - oldSize + newSize;
      }
      // update estimated item size to average of measured elements
      const newItemSizeEstimate = Math.ceil(this.totalMeasuredSize / this.measuredItemsCount);
      this._instanceProps.estimatedItemSize = newItemSizeEstimate > 0 ? newItemSizeEstimate : 0;
      //forget styles
      this._getItemStyleCache(-1);
      this.requestUpdate();
    }
  }

  // override so we can attach our custom getItemSize function
  // and also adjust our wrapped offset
  _getItemStyle = (index) => {
    const { direction, itemSize, layout } = this.props;

    const itemStyleCache = this._getItemStyleCache(
      shouldResetStyleCacheOnItemSizeChange && itemSize,
      shouldResetStyleCacheOnItemSizeChange && layout,
      shouldResetStyleCacheOnItemSizeChange && direction
    );

    let style;
    if (itemStyleCache.hasOwnProperty(index)) {
      style = itemStyleCache[index];
    } else {
      const offset = getItemOffset(this.props, index, this._instanceProps);
      const size = getItemSize(this.props, index, this._instanceProps);

      // TODO Deprecate direction "horizontal"
      const isHorizontal =
        direction === 'horizontal' || layout === 'horizontal';

      const isRtl = direction === 'rtl';
      const offsetHorizontal = isHorizontal ? offset : 0;
      const horizontalAdjustment = isHorizontal ? Math.abs(this.leastItemOffset) : 0;
      const verticalAdjustment = !isHorizontal ? Math.abs(this.leastItemOffset) : 0;
      itemStyleCache[index] = style = {
        position: 'absolute',
        left: isRtl ? undefined : offsetHorizontal + horizontalAdjustment,
        right: isRtl ? offsetHorizontal + horizontalAdjustment : undefined,
        top: !isHorizontal ? offset + verticalAdjustment : 0,
        height: !isHorizontal ? size : '100%',
        width: isHorizontal ? size : '100%',
      };
    }

    return style;
  };

  render() {
    const {
      children,
      className,
      direction,
      height,
      innerRef,
      innerElementType,
      innerTagName,
      itemCount,
      itemData,
      itemKey = defaultItemKey,
      layout,
      outerElementType,
      outerTagName,
      style,
      useIsScrolling,
      width
    } = this.props;
    const { isScrolling, scrollOffset } = this.state;

    // TODO Deprecate direction "horizontal"
    const isHorizontal = direction === "horizontal" || layout === "horizontal";

    const onScroll = isHorizontal
      ? this._onScrollHorizontal
      : this._onScrollVertical;

    const [startIndex, stopIndex] = this._getRangeToRender(scrollOffset);
    const items = [];
    if (itemCount > 0) {
      const boundSetSize = this.setSize.bind(this);
      for (let index = startIndex; index <= stopIndex; index++) {
        items.push(
          createElement(IndexedListItem, {
            data: itemData,
            key: itemKey(index, itemData),
            index,
            isScrolling: useIsScrolling ? isScrolling : undefined,
            style: this._getItemStyle(index),
            onSetSize: boundSetSize,
            childCreationCallback: children,
          })
        );
      }
    }

    // Read this value AFTER items have been created,
    // So their actual sizes (if variable) are taken into consideration.
    const estimatedTotalSize = this.getEstimatedTotalSize();

    return createElement(
      outerElementType || outerTagName || "div",
      {
        className,
        onScroll,
        ref: this._outerRefSetter,
        style: {
          position: "relative",
          height,
          width,
          overflow: "auto",
          WebkitOverflowScrolling: "touch",
          willChange: "transform",
          direction,
          ...style
        }
      },
      createElement(innerElementType || innerTagName || "div", {
        children: items,
        ref: innerRef,
        style: {
          height: isHorizontal ? "100%" : estimatedTotalSize,
          pointerEvents: isScrolling ? "none" : undefined,
          width: isHorizontal ? estimatedTotalSize : "100%"
        }
      })
    );
  }

  fixOverlaps(
    itemCount,
    fromIndex,
    endIndex,
    fromEnd
  ) {
    let fixed = false;
    if (!fromEnd) {
      for (let i = fromIndex; i < endIndex + 1; i++) {
        if (i === fromIndex) continue;
        if (i < 0) continue;
        if (i >= itemCount) break;
        const currentItemData = getItemMetadata(this.props, i, this._instanceProps);
        const prevItemData = getItemMetadata(this.props, i - 1, this._instanceProps);
        const currentOffset = currentItemData.offset;
        const prevItemEndOffset = prevItemData.offset + prevItemData.size;
        if (prevItemEndOffset !== currentOffset) {
          // move to end of prev item
          fixed = true;
          currentItemData.offset = prevItemEndOffset;
        }
      }
    } else {
      for (let i = endIndex; i >= fromIndex; i--) {
        if (i === endIndex) continue;
        if (i < 0) break;
        if (i >= itemCount) continue;
        const currentItemData = getItemMetadata(this.props, i, this._instanceProps);
        const nextItemData = getItemMetadata(this.props, i + 1, this._instanceProps);
        const calculatedOffset = nextItemData.offset - currentItemData.size;
        if (currentItemData.offset !== calculatedOffset) {
          // move to end of prev item
          fixed = true;
          currentItemData.offset = calculatedOffset;
          // update least offset since this operation is likely to push some elements below 0
          if (currentItemData.offset < this.leastItemOffset) {
            this.leastItemOffset = currentItemData.offset;
          }
        }
      }
    }
    return fixed;
  }

  _applyFixes(scrollOffset, state, props, instanceProps) {
    const { scrollDirection } = state;
    const { itemCount } = props;
    const [startIndex, stopIndex, visibleStartIndex, visibleStopIndex, usedEstimate] = this._getRangeToRender(scrollOffset);
    let fixed = false;
    // fix overlaps 
    const fromEnd = scrollDirection === "backward";
    // from visible to overscan depending on direction of scroll
    const fixStartIndex = fromEnd ? startIndex : visibleStartIndex;
    const fixStopIndex = fromEnd ? visibleStopIndex : stopIndex;

    const anchorIndex = fromEnd ? visibleStopIndex : visibleStartIndex;
    const oldOffset = getItemOffset(this.props, anchorIndex, this._instanceProps);
    let newOffset = oldOffset;
    fixed = this.fixOverlaps(
      itemCount,
      fixStartIndex,
      fixStopIndex,
      fromEnd,
    );
    newOffset = getItemOffset(this.props, anchorIndex, this._instanceProps);

    // give overscanStart items offsets
    for (let i = visibleStartIndex - 1; i >= startIndex; i--) {
      const currentItem = getItemMetadata(this.props, i, this._instanceProps);
      const nextItem = getItemMetadata(this.props, i + 1, this._instanceProps);
      currentItem.offset = nextItem.offset - currentItem.size;
    }
    // give overscanStop items offsets
    for (let i = visibleStopIndex + 1; i <= stopIndex; i++) {
      const currentItem = getItemMetadata(this.props, i, this._instanceProps);
      const prevItem = getItemMetadata(this.props, i - 1, this._instanceProps);
      currentItem.offset = prevItem.offset + prevItem.size;
    }
    const offsetChange = newOffset - oldOffset;
    if (offsetChange !== 0) {
      // anchor offset changed
      fixed = true;
    }
    if (fixed) {
      // forget styles
      this._getItemStyleCache(-1);
    }
    return { newAnchorOffset: newOffset, anchorIndex, fixStartIndex, fixStopIndex, offsetChange, fixed, usedEstimate };
  }

  _onScrollVertical = (event) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    this.setState((prevState, prevProps) => {
      if (prevState.scrollOffset === scrollTop) {
        // Scroll position may have been updated by cDM/cDU,
        // In which case we don't need to trigger another render,
        // And we don't want to update state.isScrolling.
        return null;
      }

      // Prevent Safari's elastic scrolling from causing visual shaking when scrolling past bounds.
      const scrollOffset = Math.max(
        0,
        Math.min(scrollTop, scrollHeight - clientHeight)
      );

      const { offsetChange, fixed, usedEstimate } = this._applyFixes(scrollOffset, prevState, prevProps, this._instanceProps);
      if (fixed || offsetChange !== 0 || usedEstimate) {
        // forget styles
        this._getItemStyleCache(-1);
      }
      return {
        isScrolling: true,
        scrollDirection:
          prevState.scrollOffset < scrollOffset ? 'forward' : 'backward',
        // Force update if fixed but no offset change
        scrollOffset: scrollOffset + offsetChange + (fixed || usedEstimate ? 0.1 : 0),
        scrollUpdateWasRequested: false,
      };
    }, this._resetIsScrollingDebounced);
  }

  _onScrollHorizontal = (event) => {
    const { clientWidth, scrollLeft, scrollWidth } = event.currentTarget;
    this.setState((prevState, prevProps) => {
      if (prevState.scrollOffset === scrollLeft) {
        // Scroll position may have been updated by cDM/cDU,
        // In which case we don't need to trigger another render,
        // And we don't want to update state.isScrolling.
        return null;
      }

      const { direction } = this.props;

      let scrollOffset = scrollLeft;
      if (direction === 'rtl') {
        // TRICKY According to the spec, scrollLeft should be negative for RTL aligned elements.
        // This is not the case for all browsers though (e.g. Chrome reports values as positive, measured relative to the left).
        // It's also easier for this component if we convert offsets to the same format as they would be in for ltr.
        // So the simplest solution is to determine which browser behavior we're dealing with, and convert based on it.
        switch (getRTLOffsetType()) {
          case 'negative':
            scrollOffset = -scrollLeft;
            break;
          case 'positive-descending':
            scrollOffset = scrollWidth - clientWidth - scrollLeft;
            break;
        }
      }

      // Prevent Safari's elastic scrolling from causing visual shaking when scrolling past bounds.
      scrollOffset = Math.max(
        0,
        Math.min(scrollOffset, scrollWidth - clientWidth)
      );

      const { offsetChange, fixed, usedEstimate } = this._applyFixes(scrollOffset, prevState, prevProps, this._instanceProps);
      if (fixed || offsetChange !== 0 || usedEstimate) {
        // forget styles
        this._getItemStyleCache(-1);
      }
      return {
        isScrolling: true,
        scrollDirection:
          prevState.scrollOffset < scrollLeft ? 'forward' : 'backward',
        // Force update if fixed but no offset change
        scrollOffset: scrollOffset + offsetChange + (fixed || usedEstimate ? 0.1 : 0),
        scrollUpdateWasRequested: false,
      };
    }, this._resetIsScrollingDebounced);
  };
}