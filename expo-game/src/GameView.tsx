import { GLView } from "expo-gl";
import React, { Component } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";

import GestureRecognizer, { swipeDirections } from "@/components/GestureView";
import Engine from "@/GameEngine";
import State from "@/state";

/**
 * One playable board (a "pane"). Used twice for the split-screen modes:
 *   - human pane: keyboard / swipe controls
 *   - ai pane:    the trained network drives the chicken (engine.autopilot)
 * Both panes get the same `seed`, so they race on an identical road.
 */
type Props = {
  width: number;
  height: number;
  ai: boolean;
  seed: number;
  character: string;
  onDead?: (score: number) => void;
};

export default class GameView extends Component<Props> {
  state = { ready: false, score: 0, gameState: State.Game.none };
  engine: any;
  started = false;
  startTimer: any;

  UNSAFE_componentWillMount() {
    const e = (this.engine = new Engine());
    e.seed = this.props.seed;
    e.viewport = { width: this.props.width, height: this.props.height };
    e.autopilot.enabled = this.props.ai;
    e.onUpdateScore = (position) => {
      if (this.state.score < position) this.setState({ score: position });
    };
    e.onGameInit = () => this.setState({ score: 0 });
    e._isGameStateEnded = () => this.state.gameState !== State.Game.playing;
    e.onGameReady = () => this.setState({ ready: true });
    e.onGameEnded = () => {
      this.setState({ gameState: State.Game.gameOver });
      this.props.onDead?.(this.state.score);
    };
    e.setupGame(this.props.character);
    e.init();
  }

  componentDidMount() {
    // start right away (after the GL context is up)
    this.startTimer = setTimeout(() => {
      if (this.started) return;
      this.started = true;
      this.engine.gameState = State.Game.playing;
      this.setState({ gameState: State.Game.playing });
      this.engine._hero.stopIdle();
    }, 700);
  }

  componentDidUpdate(prev: Props) {
    if (prev.width !== this.props.width || prev.height !== this.props.height) {
      this.engine.setViewport({ width: this.props.width, height: this.props.height });
    }
  }

  componentWillUnmount() {
    clearTimeout(this.startTimer);
    cancelAnimationFrame(this.engine.raf);
  }

  onSwipe = (dir) => this.engine.moveWithDirection(dir);

  render() {
    const { ai } = this.props;
    const dead = this.state.gameState === State.Game.gameOver;
    return (
      <View style={styles.pane}>
        {this.state.ready && (
          <GestureView
            disabled={ai}
            onStartGesture={this.engine.beginMoveWithDirection}
            onSwipe={this.onSwipe}
          >
            <GLView
              style={{ flex: 1, height: "100%", overflow: "hidden" }}
              onContextCreate={this.engine._onGLContextCreate}
            />
          </GestureView>
        )}
        <View pointerEvents="none" style={styles.hud}>
          <Text style={[styles.label, outline(3)]}>{ai ? "AI" : "YOU"}</Text>
          <Text style={[styles.score, outline(4)]}>{this.state.score}</Text>
        </View>
        {dead && (
          <View pointerEvents="none" style={styles.deadOverlay}>
            <Text style={[styles.dead, outline(4)]}>DEAD</Text>
          </View>
        )}
      </View>
    );
  }
}

const outline = (w: number) =>
  Platform.select({
    web: {
      textShadow: `-${w}px 0px 0px #000, ${w}px 0px 0px #000, 0px -${w}px 0px #000, 0px ${w}px 0px #000`,
    },
    default: {},
  }) as any;

const GestureView = ({ onStartGesture, onSwipe, disabled, ...props }: any) => (
  <GestureRecognizer
    disabled={disabled}
    onResponderGrant={() => onStartGesture()}
    onSwipe={(d) => onSwipe(d)}
    config={{ velocityThreshold: 0.2, directionalOffsetThreshold: 80 }}
    onTap={() => onSwipe(swipeDirections.SWIPE_UP)}
    style={{ flex: 1 }}
    {...props}
  />
);

const styles = StyleSheet.create({
  pane: { flex: 1, backgroundColor: "#87C6FF", overflow: "hidden" },
  hud: { position: "absolute", top: 12, left: 14, gap: 4 },
  label: { fontFamily: "retro", color: "#f8e84d", fontSize: 22 },
  score: { fontFamily: "retro", color: "white", fontSize: 52 },
  deadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  dead: { fontFamily: "retro", color: "#ff5a4d", fontSize: 56 },
});
